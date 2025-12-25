#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>
#include <sys/time.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"

#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_http_client.h"
#include "esp_http_server.h"
#include "esp_sntp.h"
#include "esp_mac.h"

#include "nvs_flash.h"
#include "nvs.h"

#include "driver/gpio.h"

#include "esp_hmac.h"
#include "esp_efuse.h"

#include "lwip/err.h"
#include "lwip/sys.h"
#include "lwip/sockets.h"
#include "lwip/netdb.h"

#include "captive_portal.h"

static const char *TAG = "streak";

// ============== PIN CONFIGURATION ==============
// LEDs: index 0 = oldest (left), index 6 = today (right)
// Note: ESP32-C6 has different GPIO mapping - update these for your board
static const gpio_num_t LED_PINS[7] = {
    GPIO_NUM_0, GPIO_NUM_1, GPIO_NUM_2, GPIO_NUM_3,
    GPIO_NUM_4, GPIO_NUM_5, GPIO_NUM_6
};
static const gpio_num_t BUTTON_PIN = GPIO_NUM_7;
// BOOT button on ESP32-C6-DevKitC-1 is GPIO9 - used for factory reset
static const gpio_num_t BOOT_BUTTON_PIN = GPIO_NUM_9;

// ============== NTP CONFIGURATION ==============
static const char *NTP_SERVER = "pool.ntp.org";
static long gmt_offset_sec = 0;

// ============== WEBHOOK CONFIGURATION ==============
static const char *WEBHOOK_URL = "https://us-central1-pressit-today.cloudfunctions.net/buttonPress";

// ============== HMAC CONFIGURATION ==============
// The HMAC key must be burned to eFuse block KEY4 with purpose HMAC_UP (upstream)
// Use espefuse.py to burn the key:
//   espefuse.py burn_key BLOCK_KEY4 hmac_key.bin HMAC_UP
// The key file should contain exactly 32 bytes of random data
#define HMAC_KEY_BLOCK HMAC_KEY4
static bool s_hmac_available = false;

// ============== WIFI CONFIGURATION ==============
#define WIFI_MAXIMUM_RETRY 5
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
#define AP_SSID            "The thing Will gave me"

static EventGroupHandle_t s_wifi_event_group = NULL;
static int s_retry_num = 0;
static bool s_provisioning_done = false;
static char s_claim_code[12] = {0};

// ============== STATE ==============
static uint8_t streak_data = 0;
static int last_day = -1;
static bool today_state = false;
static bool button_pressed = false;
static uint32_t last_debounce_time = 0;
static const uint32_t DEBOUNCE_DELAY = 50;
static bool last_button_state = true;
static bool ntp_synced = false;
static bool s_netif_initialized = false;

// Animation state
static int animation_index = 0;
static uint32_t last_animation_time = 0;
static const uint32_t ANIMATION_INTERVAL = 100;

// HTTP Server handle
static httpd_handle_t s_httpd = NULL;

// DNS task handle
static TaskHandle_t s_dns_task = NULL;


// ============== FUNCTION DECLARATIONS ==============
static void setup_leds(void);
static void update_leds(void);
static void animate_leds(void);
static void handle_button(void);
static void check_midnight_rollover(void);
static void shift_streak(void);
static void save_streak(void);
static void load_streak(void);
static void sync_ntp(void);
static int get_current_day(void);
static void send_webhook(bool state);
static void get_mac_address(char *mac_str, size_t len);
static void get_current_date(char *date_str, size_t len);
static void generate_claim_code(char *code, size_t len);
static bool connect_with_saved_credentials(void);
static void save_wifi_credentials(const char *ssid, const char *password);
static void start_provisioning_mode(void);
static void fetch_timezone(void);
static void setup_boot_button(void);
static void check_boot_button(void);
static void clear_wifi_credentials(void);
static void clear_streak_data(void);
static bool check_hmac_key_available(void);
static void bytes_to_hex(const uint8_t *bytes, size_t len, char *hex_str);
static bool calculate_hmac_signature(const char *message, size_t message_len, char *signature_hex);

// ============== UTILITY FUNCTIONS ==============

static uint32_t millis(void) {
    return (uint32_t)(xTaskGetTickCount() * portTICK_PERIOD_MS);
}

// Convert bytes to hex string
static void bytes_to_hex(const uint8_t *bytes, size_t len, char *hex_str) {
    static const char hex_chars[] = "0123456789abcdef";
    for (size_t i = 0; i < len; i++) {
        hex_str[i * 2] = hex_chars[(bytes[i] >> 4) & 0x0F];
        hex_str[i * 2 + 1] = hex_chars[bytes[i] & 0x0F];
    }
    hex_str[len * 2] = '\0';
}

// Check if HMAC key is available in eFuse
static bool check_hmac_key_available(void) {
    // Try a test HMAC calculation to verify the key is programmed
    uint8_t test_hmac[32];
    const char *test_msg = "test";

    esp_err_t err = esp_hmac_calculate(HMAC_KEY_BLOCK, test_msg, 4, test_hmac);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Hardware HMAC key available in eFuse BLOCK_KEY4");
        return true;
    } else {
        ESP_LOGW(TAG, "Hardware HMAC key not available (err: %s). Webhook requests will not be signed.",
                 esp_err_to_name(err));
        ESP_LOGW(TAG, "To enable HMAC signing, burn a 32-byte key to eFuse:");
        ESP_LOGW(TAG, "  espefuse.py burn_key BLOCK_KEY4 hmac_key.bin HMAC_UP");
        return false;
    }
}

// Calculate HMAC-SHA256 signature using hardware peripheral
// Returns true on success, signature_hex must be at least 65 bytes (64 hex chars + null)
static bool calculate_hmac_signature(const char *message, size_t message_len, char *signature_hex) {
    if (!s_hmac_available) {
        return false;
    }

    uint8_t hmac[32];
    esp_err_t err = esp_hmac_calculate(HMAC_KEY_BLOCK, message, message_len, hmac);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "HMAC calculation failed: %s", esp_err_to_name(err));
        return false;
    }

    bytes_to_hex(hmac, 32, signature_hex);
    return true;
}

// ============== WIFI EVENT HANDLER ==============

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry_num < WIFI_MAXIMUM_RETRY) {
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGI(TAG, "Retrying WiFi connection...");
        } else {
            if (s_wifi_event_group) {
                xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
            }
        }
        ESP_LOGI(TAG, "WiFi connection failed");
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        s_retry_num = 0;
        if (s_wifi_event_group) {
            xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        }
    }
}

// ============== LED FUNCTIONS ==============

static void setup_leds(void) {
    gpio_config_t io_conf = {
        .pin_bit_mask = 0,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };

    for (int i = 0; i < 7; i++) {
        io_conf.pin_bit_mask |= (1ULL << LED_PINS[i]);
    }
    gpio_config(&io_conf);

    for (int i = 0; i < 7; i++) {
        gpio_set_level(LED_PINS[i], 0);
    }
}

static void update_leds(void) {
    for (int i = 0; i < 7; i++) {
        bool state = (streak_data >> i) & 1;
        gpio_set_level(LED_PINS[i], state ? 1 : 0);
    }
}

static void animate_leds(void) {
    uint32_t now = millis();
    if (now - last_animation_time >= ANIMATION_INTERVAL) {
        last_animation_time = now;

        for (int i = 0; i < 7; i++) {
            gpio_set_level(LED_PINS[i], 0);
        }

        int led_index;
        int cycle = animation_index % 12;
        if (cycle < 7) {
            led_index = cycle;
        } else {
            led_index = 12 - cycle;
        }

        gpio_set_level(LED_PINS[led_index], 1);
        animation_index++;
    }
}

// ============== BUTTON HANDLING ==============

static void setup_button(void) {
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << BUTTON_PIN),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
}

// Setup boot button GPIO
static void setup_boot_button(void) {
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << BOOT_BUTTON_PIN),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
}

// State for boot button hold detection
static uint32_t boot_button_hold_start = 0;
static bool boot_button_was_pressed = false;

// Check boot button state - call this from main loop
// Triggers factory reset if held for 5 seconds
static void check_boot_button(void) {
    const uint32_t RESET_HOLD_TIME_MS = 5000;

    bool is_pressed = (gpio_get_level(BOOT_BUTTON_PIN) == 0);

    if (is_pressed && !boot_button_was_pressed) {
        // Button just pressed
        boot_button_hold_start = millis();
        boot_button_was_pressed = true;
        ESP_LOGI(TAG, "BOOT button pressed - hold for 5 seconds to factory reset...");
    } else if (!is_pressed && boot_button_was_pressed) {
        // Button released
        boot_button_was_pressed = false;
        ESP_LOGI(TAG, "BOOT button released - reset cancelled");
        // Restore LEDs
        update_leds();
    } else if (is_pressed && boot_button_was_pressed) {
        // Button still held
        uint32_t elapsed = millis() - boot_button_hold_start;

        // Log countdown every second
        static int last_seconds_remaining = -1;
        int seconds_remaining = (RESET_HOLD_TIME_MS - elapsed + 999) / 1000;
        if (seconds_remaining != last_seconds_remaining && seconds_remaining > 0 && seconds_remaining <= 5) {
            ESP_LOGI(TAG, "Resetting in %ds...", seconds_remaining);
            last_seconds_remaining = seconds_remaining;
        }

        // Visual feedback: light up LEDs progressively
        int leds_to_light = (elapsed * 7) / RESET_HOLD_TIME_MS;
        if (leds_to_light > 7) leds_to_light = 7;
        for (int i = 0; i < 7; i++) {
            gpio_set_level(LED_PINS[i], i < leds_to_light ? 1 : 0);
        }

        // Check if held long enough
        if (elapsed >= RESET_HOLD_TIME_MS) {
            ESP_LOGW(TAG, "Factory reset triggered by BOOT button!");

            // Flash all LEDs 3 times to confirm
            for (int flash = 0; flash < 3; flash++) {
                for (int i = 0; i < 7; i++) {
                    gpio_set_level(LED_PINS[i], 1);
                }
                vTaskDelay(pdMS_TO_TICKS(200));
                for (int i = 0; i < 7; i++) {
                    gpio_set_level(LED_PINS[i], 0);
                }
                vTaskDelay(pdMS_TO_TICKS(200));
            }

            // Clear all data
            clear_wifi_credentials();
            clear_streak_data();

            ESP_LOGI(TAG, "Factory reset complete - restarting...");
            vTaskDelay(pdMS_TO_TICKS(500));
            esp_restart();
        }
    } else {
        // Reset countdown display state when button not pressed
        static int last_seconds_remaining = -1;
        last_seconds_remaining = -1;
    }
}

static void handle_button(void) {
    bool reading = gpio_get_level(BUTTON_PIN);

    if (reading != last_button_state) {
        last_debounce_time = millis();
    }

    if ((millis() - last_debounce_time) > DEBOUNCE_DELAY) {
        if (reading == 0 && !button_pressed) {
            button_pressed = true;
            today_state = !today_state;

            if (today_state) {
                streak_data |= (1 << 6);
            } else {
                streak_data &= ~(1 << 6);
            }

            update_leds();
            save_streak();
            send_webhook(today_state);

            ESP_LOGI(TAG, "Today toggled: %s | Streak: %d%d%d%d%d%d%d",
                     today_state ? "ON" : "OFF",
                     (streak_data >> 6) & 1, (streak_data >> 5) & 1,
                     (streak_data >> 4) & 1, (streak_data >> 3) & 1,
                     (streak_data >> 2) & 1, (streak_data >> 1) & 1,
                     streak_data & 1);
        } else if (reading == 1) {
            button_pressed = false;
        }
    }

    last_button_state = reading;
}

// ============== TIME & MIDNIGHT ROLLOVER ==============

static char tz_response_buffer[128];
static int tz_response_len = 0;

static esp_err_t tz_http_event_handler(esp_http_client_event_t *evt) {
    switch (evt->event_id) {
        case HTTP_EVENT_ON_DATA:
            if (tz_response_len + evt->data_len < sizeof(tz_response_buffer) - 1) {
                memcpy(tz_response_buffer + tz_response_len, evt->data, evt->data_len);
                tz_response_len += evt->data_len;
                tz_response_buffer[tz_response_len] = '\0';
            }
            break;
        default:
            break;
    }
    return ESP_OK;
}

static void fetch_timezone(void) {
    ESP_LOGI(TAG, "Detecting timezone from IP...");

    tz_response_len = 0;
    tz_response_buffer[0] = '\0';

    esp_http_client_config_t config = {
        .url = "http://ip-api.com/json/?fields=offset",
        .timeout_ms = 10000,
        .event_handler = tz_http_event_handler,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        int status = esp_http_client_get_status_code(client);
        ESP_LOGI(TAG, "Timezone API response: %d, body: %s", status, tz_response_buffer);
        if (status == 200 && tz_response_len > 0) {
            // Response format: {"offset":-25200}
            char *offset_str = strstr(tz_response_buffer, "\"offset\":");
            if (offset_str) {
                gmt_offset_sec = atol(offset_str + 9);  // Skip past "offset":
                ESP_LOGI(TAG, "Detected timezone offset: %ld seconds (UTC%+.1f)",
                         gmt_offset_sec, gmt_offset_sec / 3600.0);
            }
        }
    } else {
        ESP_LOGW(TAG, "Timezone detection failed: %s", esp_err_to_name(err));
    }
    esp_http_client_cleanup(client);
}

static void time_sync_notification_cb(struct timeval *tv) {
    ESP_LOGI(TAG, "NTP time synchronized");
    ntp_synced = true;
}

static void sync_ntp(void) {
    fetch_timezone();

    ESP_LOGI(TAG, "Syncing time with NTP server: %s", NTP_SERVER);

    // Configure SNTP
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, NTP_SERVER);
    esp_sntp_set_time_sync_notification_cb(time_sync_notification_cb);
    esp_sntp_init();

    ESP_LOGI(TAG, "SNTP initialized, waiting for sync...");

    // Wait for sync using our callback flag
    int attempts = 0;
    while (!ntp_synced && attempts < 30) {
        vTaskDelay(pdMS_TO_TICKS(1000));

        // Check SNTP status for debugging
        sntp_sync_status_t status = sntp_get_sync_status();
        ESP_LOGI(TAG, "Waiting for NTP sync... (status: %d, attempt %d/30)", status, attempts + 1);
        attempts++;
    }

    if (ntp_synced) {
        setenv("TZ", "UTC", 1);
        tzset();

        time_t now;
        struct tm timeinfo;
        time(&now);
        now += gmt_offset_sec;
        localtime_r(&now, &timeinfo);

        last_day = timeinfo.tm_yday;
        ESP_LOGI(TAG, "Time synced! Current time: %02d:%02d:%02d",
                 timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);

        nvs_handle_t nvs;
        if (nvs_open("streak", NVS_READONLY, &nvs) == ESP_OK) {
            int32_t saved_day = -1;
            nvs_get_i32(nvs, "lastDay", &saved_day);
            nvs_close(nvs);

            if (saved_day != -1 && saved_day != last_day) {
                int days_passed = last_day - saved_day;
                if (days_passed < 0) days_passed += 365;

                ESP_LOGI(TAG, "Days since last use: %d", days_passed);
                for (int i = 0; i < days_passed && i < 7; i++) {
                    shift_streak();
                }
                save_streak();
            }
        }
    } else {
        ESP_LOGW(TAG, "Failed to sync time - using saved state");
    }
}

static int get_current_day(void) {
    time_t now;
    struct tm timeinfo;
    time(&now);
    now += gmt_offset_sec;
    localtime_r(&now, &timeinfo);
    return timeinfo.tm_yday;
}

static void check_midnight_rollover(void) {
    if (!ntp_synced) return;

    int current_day = get_current_day();
    if (current_day == -1) return;

    if (last_day != -1 && current_day != last_day) {
        ESP_LOGI(TAG, "Midnight! Shifting streak...");
        shift_streak();
        save_streak();
        last_day = current_day;
    }
}

static void shift_streak(void) {
    streak_data = streak_data >> 1;
    streak_data &= ~(1 << 6);
    today_state = false;
    update_leds();

    ESP_LOGI(TAG, "Streak after shift: %d%d%d%d%d%d%d",
             (streak_data >> 6) & 1, (streak_data >> 5) & 1,
             (streak_data >> 4) & 1, (streak_data >> 3) & 1,
             (streak_data >> 2) & 1, (streak_data >> 1) & 1,
             streak_data & 1);
}

// ============== PERSISTENCE ==============

static void load_streak(void) {
    nvs_handle_t nvs;
    if (nvs_open("streak", NVS_READONLY, &nvs) == ESP_OK) {
        uint8_t data = 0;
        int32_t day = -1;
        nvs_get_u8(nvs, "data", &data);
        nvs_get_i32(nvs, "lastDay", &day);
        nvs_close(nvs);

        streak_data = data;
        last_day = day;
    }

    today_state = (streak_data >> 6) & 1;

    ESP_LOGI(TAG, "Loaded streak: %d%d%d%d%d%d%d",
             (streak_data >> 6) & 1, (streak_data >> 5) & 1,
             (streak_data >> 4) & 1, (streak_data >> 3) & 1,
             (streak_data >> 2) & 1, (streak_data >> 1) & 1,
             streak_data & 1);
}

static void save_streak(void) {
    nvs_handle_t nvs;
    if (nvs_open("streak", NVS_READWRITE, &nvs) == ESP_OK) {
        nvs_set_u8(nvs, "data", streak_data);
        if (last_day != -1) {
            nvs_set_i32(nvs, "lastDay", last_day);
        }
        nvs_commit(nvs);
        nvs_close(nvs);
    }
}

// ============== WEBHOOK ==============

static void get_mac_address(char *mac_str, size_t len) {
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(mac_str, len, "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

static void get_current_date(char *date_str, size_t len) {
    time_t now;
    struct tm timeinfo;
    time(&now);
    now += gmt_offset_sec;
    localtime_r(&now, &timeinfo);
    snprintf(date_str, len, "%04d-%02d-%02d",
             timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday);
}

static void send_webhook(bool state) {
    wifi_ap_record_t ap_info;
    if (esp_wifi_sta_get_ap_info(&ap_info) != ESP_OK) {
        ESP_LOGW(TAG, "Webhook skipped - WiFi not connected");
        return;
    }

    char mac_str[18];
    char date_str[11];
    get_mac_address(mac_str, sizeof(mac_str));
    get_current_date(date_str, sizeof(date_str));

    // Get Unix timestamp for replay protection
    time_t now;
    time(&now);

    // Build payload with timestamp
    char payload[256];
    snprintf(payload, sizeof(payload),
             "{\"mac\":\"%s\",\"state\":%s,\"date\":\"%s\",\"timestamp\":%lld}",
             mac_str, state ? "true" : "false", date_str, (long long)now);

    ESP_LOGI(TAG, "Sending webhook: %s", payload);

    esp_http_client_config_t config = {
        .url = WEBHOOK_URL,
        .timeout_ms = 10000,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);

    esp_http_client_set_method(client, HTTP_METHOD_POST);
    esp_http_client_set_header(client, "Content-Type", "application/json");

    // Calculate and add HMAC signature if available
    char signature_hex[65];
    if (calculate_hmac_signature(payload, strlen(payload), signature_hex)) {
        esp_http_client_set_header(client, "X-HMAC-Signature", signature_hex);
        ESP_LOGI(TAG, "Request signed with hardware HMAC");
    }

    esp_http_client_set_post_field(client, payload, strlen(payload));

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        int status = esp_http_client_get_status_code(client);
        ESP_LOGI(TAG, "Webhook response: %d", status);
    } else {
        ESP_LOGE(TAG, "Webhook failed: %s", esp_err_to_name(err));
    }

    esp_http_client_cleanup(client);
}

static void generate_claim_code(char *code, size_t len) {
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);

    char mac_str[13];
    snprintf(mac_str, sizeof(mac_str), "%02X%02X%02X%02X%02X%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    uint32_t hash = 0;
    for (int i = 0; i < 12; i++) {
        hash = hash * 31 + mac_str[i];
    }

    for (int i = 0; i < 6; i++) {
        hash ^= (mac[i] << (i * 4));
    }

    const char *chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (int i = 0; i < 10 && i < (int)len - 1; i++) {
        code[i] = chars[hash % 32];
        hash /= 32;
    }
    code[10 < len - 1 ? 10 : len - 1] = '\0';
}

// ============== WIFI CREDENTIAL PERSISTENCE ==============

static void save_wifi_credentials(const char *ssid, const char *password) {
    nvs_handle_t nvs;
    if (nvs_open("wifi", NVS_READWRITE, &nvs) == ESP_OK) {
        nvs_set_str(nvs, "ssid", ssid);
        nvs_set_str(nvs, "password", password ? password : "");
        nvs_commit(nvs);
        nvs_close(nvs);
        ESP_LOGI(TAG, "WiFi credentials saved for SSID: %s", ssid);
    }
}

static void clear_wifi_credentials(void) {
    nvs_handle_t nvs;
    if (nvs_open("wifi", NVS_READWRITE, &nvs) == ESP_OK) {
        nvs_erase_all(nvs);
        nvs_commit(nvs);
        nvs_close(nvs);
        ESP_LOGI(TAG, "WiFi credentials cleared");
    }
}

static void clear_streak_data(void) {
    nvs_handle_t nvs;
    if (nvs_open("streak", NVS_READWRITE, &nvs) == ESP_OK) {
        nvs_erase_all(nvs);
        nvs_commit(nvs);
        nvs_close(nvs);
        ESP_LOGI(TAG, "Streak data cleared");
    }
    streak_data = 0;
    today_state = false;
    last_day = -1;
    update_leds();
}

// ============== CAPTIVE PORTAL HTTP HANDLERS ==============

static esp_err_t http_get_handler(httpd_req_t *req) {
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, CAPTIVE_PORTAL_HTML, CAPTIVE_PORTAL_HTML_LEN);
    return ESP_OK;
}

static esp_err_t http_redirect_handler(httpd_req_t *req) {
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "http://192.168.4.1/");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
}

static esp_err_t http_scan_handler(httpd_req_t *req) {
    ESP_LOGI(TAG, "Scanning for WiFi networks...");

    wifi_scan_config_t scan_config = {
        .ssid = NULL,
        .bssid = NULL,
        .channel = 0,
        .show_hidden = false,
        .scan_type = WIFI_SCAN_TYPE_ACTIVE,
        .scan_time.active.min = 100,
        .scan_time.active.max = 300,
    };

    esp_wifi_scan_start(&scan_config, true);

    uint16_t ap_count = 0;
    esp_wifi_scan_get_ap_num(&ap_count);
    if (ap_count > 20) ap_count = 20;

    wifi_ap_record_t *ap_records = malloc(sizeof(wifi_ap_record_t) * ap_count);
    if (!ap_records) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Memory error");
        return ESP_FAIL;
    }

    esp_wifi_scan_get_ap_records(&ap_count, ap_records);

    char *response = malloc(2048);
    if (!response) {
        free(ap_records);
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Memory error");
        return ESP_FAIL;
    }

    strcpy(response, "{\"networks\":[");
    int offset = strlen(response);

    for (int i = 0; i < ap_count; i++) {
        if (strlen((char *)ap_records[i].ssid) == 0) continue;

        int rssi_level;
        if (ap_records[i].rssi >= -50) rssi_level = 4;
        else if (ap_records[i].rssi >= -60) rssi_level = 3;
        else if (ap_records[i].rssi >= -70) rssi_level = 2;
        else rssi_level = 1;

        offset += snprintf(response + offset, 2048 - offset,
                           "%s{\"ssid\":\"%s\",\"rssi\":%d,\"auth\":%d}",
                           (offset > 15) ? "," : "",
                           (char *)ap_records[i].ssid,
                           ap_records[i].rssi,
                           ap_records[i].authmode);
    }

    strcat(response, "]}");

    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, response, strlen(response));

    free(ap_records);
    free(response);
    return ESP_OK;
}

static esp_err_t http_connect_handler(httpd_req_t *req) {
    char content[256];
    int ret = httpd_req_recv(req, content, sizeof(content) - 1);
    if (ret <= 0) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid request");
        return ESP_FAIL;
    }
    content[ret] = '\0';

    ESP_LOGI(TAG, "Connect request: %s", content);

    // Simple JSON parsing
    char ssid[33] = {0};
    char password[65] = {0};

    char *ssid_start = strstr(content, "\"ssid\":\"");
    if (ssid_start) {
        ssid_start += 8;
        char *ssid_end = strchr(ssid_start, '"');
        if (ssid_end) {
            size_t len = ssid_end - ssid_start;
            if (len < sizeof(ssid)) {
                strncpy(ssid, ssid_start, len);
            }
        }
    }

    char *pass_start = strstr(content, "\"password\":\"");
    if (pass_start) {
        pass_start += 12;
        char *pass_end = strchr(pass_start, '"');
        if (pass_end) {
            size_t len = pass_end - pass_start;
            if (len < sizeof(password)) {
                strncpy(password, pass_start, len);
            }
        }
    }

    if (strlen(ssid) == 0) {
        httpd_resp_set_type(req, "application/json");
        httpd_resp_send(req, "{\"success\":false,\"error\":\"No SSID provided\"}", -1);
        return ESP_OK;
    }

    ESP_LOGI(TAG, "Attempting to connect to: %s", ssid);

    // Configure and connect to the network
    wifi_config_t wifi_config = {
        .sta = {
            .threshold.authmode = WIFI_AUTH_OPEN,
        },
    };
    strncpy((char *)wifi_config.sta.ssid, ssid, sizeof(wifi_config.sta.ssid) - 1);
    if (strlen(password) > 0) {
        strncpy((char *)wifi_config.sta.password, password, sizeof(wifi_config.sta.password) - 1);
        wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    }

    // Clear previous connection state
    s_retry_num = 0;
    if (s_wifi_event_group) {
        xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT | WIFI_FAIL_BIT);
    }

    // Disconnect from current AP connection attempts
    esp_wifi_disconnect();
    vTaskDelay(pdMS_TO_TICKS(100));

    // Set STA config and connect
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    esp_wifi_connect();

    // Wait for connection result
    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
                                           WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
                                           pdFALSE, pdFALSE,
                                           pdMS_TO_TICKS(15000));

    char response[256];
    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Successfully connected to %s", ssid);
        save_wifi_credentials(ssid, password);
        s_provisioning_done = true;

        snprintf(response, sizeof(response),
                 "{\"success\":true,\"claim_code\":\"%s\"}", s_claim_code);
    } else {
        ESP_LOGW(TAG, "Failed to connect to %s", ssid);
        snprintf(response, sizeof(response),
                 "{\"success\":false,\"error\":\"Failed to connect to network\"}");
    }

    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, response, strlen(response));
    return ESP_OK;
}

static esp_err_t http_reset_handler(httpd_req_t *req) {
    ESP_LOGI(TAG, "Factory reset requested");

    clear_wifi_credentials();
    clear_streak_data();

    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, "{\"success\":true}", -1);

    // Schedule restart
    vTaskDelay(pdMS_TO_TICKS(1000));
    esp_restart();

    return ESP_OK;
}

static httpd_handle_t start_webserver(void) {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers = 10;
    config.lru_purge_enable = true;
    config.recv_wait_timeout = 10;
    config.send_wait_timeout = 10;
    config.stack_size = 8192;
    config.uri_match_fn = httpd_uri_match_wildcard;

    ESP_LOGI(TAG, "Starting HTTP server on port %d", config.server_port);

    if (httpd_start(&s_httpd, &config) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server");
        return NULL;
    }

    // Main page
    httpd_uri_t root = {
        .uri = "/",
        .method = HTTP_GET,
        .handler = http_get_handler,
    };
    httpd_register_uri_handler(s_httpd, &root);

    // API endpoints
    httpd_uri_t scan = {
        .uri = "/api/scan",
        .method = HTTP_GET,
        .handler = http_scan_handler,
    };
    httpd_register_uri_handler(s_httpd, &scan);

    httpd_uri_t connect_uri = {
        .uri = "/api/connect",
        .method = HTTP_POST,
        .handler = http_connect_handler,
    };
    httpd_register_uri_handler(s_httpd, &connect_uri);

    httpd_uri_t reset = {
        .uri = "/api/reset",
        .method = HTTP_POST,
        .handler = http_reset_handler,
    };
    httpd_register_uri_handler(s_httpd, &reset);

    // Captive portal redirects
    httpd_uri_t generate_204 = {
        .uri = "/generate_204",
        .method = HTTP_GET,
        .handler = http_redirect_handler,
    };
    httpd_register_uri_handler(s_httpd, &generate_204);

    httpd_uri_t hotspot = {
        .uri = "/hotspot-detect.html",
        .method = HTTP_GET,
        .handler = http_redirect_handler,
    };
    httpd_register_uri_handler(s_httpd, &hotspot);

    httpd_uri_t ncsi = {
        .uri = "/ncsi.txt",
        .method = HTTP_GET,
        .handler = http_redirect_handler,
    };
    httpd_register_uri_handler(s_httpd, &ncsi);

    httpd_uri_t connecttest = {
        .uri = "/connecttest.txt",
        .method = HTTP_GET,
        .handler = http_redirect_handler,
    };
    httpd_register_uri_handler(s_httpd, &connecttest);

    // Catch-all for any other URLs - redirect to main page
    httpd_uri_t catchall = {
        .uri = "/*",
        .method = HTTP_GET,
        .handler = http_redirect_handler,
    };
    httpd_register_uri_handler(s_httpd, &catchall);

    return s_httpd;
}

static void stop_webserver(void) {
    if (s_httpd) {
        httpd_stop(s_httpd);
        s_httpd = NULL;
    }
}

// ============== DNS SERVER FOR CAPTIVE PORTAL ==============

static void dns_server_task(void *pvParameters) {
    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock < 0) {
        ESP_LOGE(TAG, "Failed to create DNS socket");
        vTaskDelete(NULL);
        return;
    }

    struct sockaddr_in server_addr = {
        .sin_family = AF_INET,
        .sin_port = htons(53),
        .sin_addr.s_addr = htonl(INADDR_ANY),
    };

    if (bind(sock, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
        ESP_LOGE(TAG, "Failed to bind DNS socket");
        close(sock);
        vTaskDelete(NULL);
        return;
    }

    ESP_LOGI(TAG, "DNS server started");

    uint8_t buffer[512];
    struct sockaddr_in client_addr;
    socklen_t client_len = sizeof(client_addr);

    // Our AP IP address
    uint8_t ap_ip[4] = {192, 168, 4, 1};

    while (1) {
        int len = recvfrom(sock, buffer, sizeof(buffer), 0,
                           (struct sockaddr *)&client_addr, &client_len);
        if (len < 12) continue;

        // Build DNS response
        buffer[2] = 0x81;  // Response, recursion desired
        buffer[3] = 0x80;  // Recursion available
        buffer[6] = 0x00;  // Answer count high byte
        buffer[7] = 0x01;  // Answer count low byte

        // Skip question section to find end
        int pos = 12;
        while (pos < len && buffer[pos] != 0) {
            pos += buffer[pos] + 1;
        }
        pos += 5;  // Skip null byte and QTYPE/QCLASS

        // Add answer
        buffer[pos++] = 0xc0;  // Pointer to name
        buffer[pos++] = 0x0c;  // Offset 12
        buffer[pos++] = 0x00;  // Type A
        buffer[pos++] = 0x01;
        buffer[pos++] = 0x00;  // Class IN
        buffer[pos++] = 0x01;
        buffer[pos++] = 0x00;  // TTL
        buffer[pos++] = 0x00;
        buffer[pos++] = 0x00;
        buffer[pos++] = 0x3c;  // 60 seconds
        buffer[pos++] = 0x00;  // Data length
        buffer[pos++] = 0x04;  // 4 bytes
        buffer[pos++] = ap_ip[0];
        buffer[pos++] = ap_ip[1];
        buffer[pos++] = ap_ip[2];
        buffer[pos++] = ap_ip[3];

        sendto(sock, buffer, pos, 0, (struct sockaddr *)&client_addr, client_len);
    }

    close(sock);
    vTaskDelete(NULL);
}

// ============== PROVISIONING MODE ==============

static void start_provisioning_mode(void) {
    ESP_LOGI(TAG, "Starting WiFi provisioning (captive portal)...");

    // Initialize networking if not already done
    if (!s_netif_initialized) {
        ESP_ERROR_CHECK(esp_netif_init());
        ESP_ERROR_CHECK(esp_event_loop_create_default());
        esp_netif_create_default_wifi_sta();
        s_netif_initialized = true;
    }

    // Create AP interface
    esp_netif_create_default_wifi_ap();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    s_wifi_event_group = xEventGroupCreate();

    // Register event handlers
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &wifi_event_handler,
                                                        NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &wifi_event_handler,
                                                        NULL, NULL));

    // Configure AP
    wifi_config_t ap_config = {
        .ap = {
            .ssid = AP_SSID,
            .ssid_len = strlen(AP_SSID),
            .channel = 1,
            .password = "",
            .max_connection = 4,
            .authmode = WIFI_AUTH_OPEN,
        },
    };

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "AP started: %s", AP_SSID);

    // Start DNS server for captive portal
    xTaskCreate(dns_server_task, "dns_server", 4096, NULL, 5, &s_dns_task);

    // Start HTTP server
    start_webserver();

    // Wait for provisioning to complete
    while (!s_provisioning_done) {
        animate_leds();
        vTaskDelay(pdMS_TO_TICKS(10));
    }

    ESP_LOGI(TAG, "Provisioning complete!");

    // Stop captive portal services
    stop_webserver();
    if (s_dns_task) {
        vTaskDelete(s_dns_task);
        s_dns_task = NULL;
    }

    // Switch to STA only mode
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));

    // Turn off animation LEDs
    for (int i = 0; i < 7; i++) {
        gpio_set_level(LED_PINS[i], 0);
    }
}

static bool connect_with_saved_credentials(void) {
    nvs_handle_t nvs;
    char ssid[33] = {0};
    char password[65] = {0};
    size_t ssid_len = sizeof(ssid);
    size_t pass_len = sizeof(password);

    if (nvs_open("wifi", NVS_READONLY, &nvs) != ESP_OK) {
        ESP_LOGI(TAG, "No saved WiFi credentials found");
        return false;
    }

    esp_err_t err = nvs_get_str(nvs, "ssid", ssid, &ssid_len);
    if (err != ESP_OK || strlen(ssid) == 0) {
        nvs_close(nvs);
        ESP_LOGI(TAG, "No saved WiFi credentials found");
        return false;
    }

    nvs_get_str(nvs, "password", password, &pass_len);
    nvs_close(nvs);

    ESP_LOGI(TAG, "Attempting to connect to saved network: %s", ssid);

    // Initialize networking
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    s_netif_initialized = true;

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    s_wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &wifi_event_handler,
                                                        NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &wifi_event_handler,
                                                        NULL, NULL));

    wifi_config_t wifi_config = {
        .sta = {
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        },
    };
    strncpy((char *)wifi_config.sta.ssid, ssid, sizeof(wifi_config.sta.ssid) - 1);
    strncpy((char *)wifi_config.sta.password, password, sizeof(wifi_config.sta.password) - 1);

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    // Animate LEDs while connecting
    uint32_t start_time = millis();
    const uint32_t timeout = 15000;

    while ((millis() - start_time) < timeout) {
        animate_leds();

        EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
                                               WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
                                               pdFALSE, pdFALSE,
                                               pdMS_TO_TICKS(100));
        if (bits & (WIFI_CONNECTED_BIT | WIFI_FAIL_BIT)) {
            break;
        }
    }

    // Turn off animation LEDs
    for (int i = 0; i < 7; i++) {
        gpio_set_level(LED_PINS[i], 0);
    }

    EventBits_t bits = xEventGroupGetBits(s_wifi_event_group);
    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Connected to %s", ssid);
        return true;
    }

    ESP_LOGW(TAG, "Failed to connect with saved credentials");
    esp_wifi_stop();
    esp_wifi_deinit();
    // Note: esp_netif is kept initialized for provisioning mode
    vEventGroupDelete(s_wifi_event_group);
    s_wifi_event_group = NULL;

    return false;
}

// ============== MAIN ==============

void app_main(void) {
    ESP_LOGI(TAG, "\n\n=== Streak Tracker ===");

    // Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Generate claim code
    generate_claim_code(s_claim_code, sizeof(s_claim_code));

    // Log device identification
    char mac_str[18];
    get_mac_address(mac_str, sizeof(mac_str));

    // Check if hardware HMAC key is available
    s_hmac_available = check_hmac_key_available();

    ESP_LOGI(TAG, "----------------------------------------");
    ESP_LOGI(TAG, "MAC Address:  %s", mac_str);
    ESP_LOGI(TAG, "Claim Code:   %s", s_claim_code);
    ESP_LOGI(TAG, "HMAC Signing: %s", s_hmac_available ? "ENABLED" : "DISABLED");
    ESP_LOGI(TAG, "----------------------------------------");

    // Initialize hardware
    setup_leds();
    setup_button();
    setup_boot_button();

    // Load saved streak data
    load_streak();
    update_leds();

    // Try to connect with saved WiFi credentials
    if (connect_with_saved_credentials()) {
        ESP_LOGI(TAG, "Connected with saved credentials!");
    } else {
        ESP_LOGI(TAG, "No saved credentials or connection failed, starting provisioning...");
        start_provisioning_mode();
    }

    // Restore streak LEDs after WiFi setup
    update_leds();

    // Sync time
    sync_ntp();

    // Main loop
    uint32_t last_time_log = 0;
    while (true) {
        handle_button();
        check_boot_button();
        check_midnight_rollover();

        // Log local time every 10 seconds
        uint32_t now = millis();
        if (now - last_time_log >= 10000) {
            last_time_log = now;
            time_t t = time(NULL);
            t += gmt_offset_sec;  // Apply timezone offset
            struct tm timeinfo;
            localtime_r(&t, &timeinfo);
            ESP_LOGI(TAG, "Local time: %04d-%02d-%02d %02d:%02d:%02d (UTC%+.1f)",
                     timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                     timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec,
                     gmt_offset_sec / 3600.0);
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
