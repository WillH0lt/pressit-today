#include <Arduino.h>
#include <WiFiProvisioner.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <time.h>

// ============== PIN CONFIGURATION ==============
// LEDs: index 0 = oldest (left), index 6 = today (right)
const int LED_PINS[7] = {2, 4, 5, 18, 19, 21, 22};
const int BUTTON_PIN = 15;

// ============== NTP CONFIGURATION ==============
const char* NTP_SERVER = "pool.ntp.org";
long gmtOffsetSec = 0;  // Will be auto-detected from IP geolocation

// ============== WEBHOOK CONFIGURATION ==============
// Firebase Cloud Function endpoint - update region if needed
const char* WEBHOOK_URL = "https://us-central1-pressit-today.cloudfunctions.net/buttonPress";

// ============== STATE ==============
Preferences preferences;
uint8_t streakData = 0;       // Bitmask: bit 0 = 6 days ago, bit 6 = today
int lastDay = -1;             // Track the last known day to detect midnight rollover
bool todayState = false;      // Current state of today's LED
bool buttonPressed = false;
unsigned long lastDebounceTime = 0;
const unsigned long DEBOUNCE_DELAY = 50;

// Animation state for provisioning
int animationIndex = 0;
unsigned long lastAnimationTime = 0;
const unsigned long ANIMATION_INTERVAL = 100;  // ms between LED changes
bool lastButtonState = HIGH;
bool ntpSynced = false;

// ============== FUNCTION DECLARATIONS ==============
void setupLEDs();
void updateLEDs();
void animateLEDs();
void handleButton();
void checkMidnightRollover();
void shiftStreak();
void saveStreak();
void loadStreak();
void syncNTP();
int getCurrentDay();
void sendWebhook(bool state);
String getMacAddress();
String getCurrentDate();
String generateClaimCode();

void setup() {
  Serial.begin(115200);
  delay(1000);  // Give Serial time to initialize
  Serial.println("\n\n=== Streak Tracker ===");

  // Log device identification info for server registration
  WiFi.mode(WIFI_STA);  // Need to init WiFi to get MAC
  String mac = getMacAddress();
  String claimCode = generateClaimCode();
  Serial.println("----------------------------------------");
  Serial.printf("MAC Address:  %s\n", mac.c_str());
  Serial.printf("Claim Code:   %s\n", claimCode.c_str());
  Serial.println("----------------------------------------");

  Serial.println("Serial initialized, starting setup...");

  // Initialize LEDs
  setupLEDs();

  // Initialize button with internal pull-up
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Load saved streak data
  loadStreak();
  updateLEDs();

  // WiFi Provisioning configuration
  WiFiProvisioner::Config config(
      "StreakTracker",              // Access Point Name
      "Streak Tracker Setup",       // HTML Page Title
      "#4CAF50",                    // Theme Color (green for streaks!)
      "",                           // No custom SVG
      "Streak Tracker",             // Project Title
      "7-Day Habit Tracker",        // Project Sub-title
      "Connect your streak tracker to WiFi to enable time synchronization.",
      "Streak Tracker",             // Footer
      "Connected! Your streak tracker is now syncing time.",
      "This will erase all settings and streak data.",
      "",                           // No input field needed
      0,
      false,                        // Hide input field
      true                          // Show reset option
  );

  WiFiProvisioner provisioner(config);

  provisioner.onProvision([]() {
    Serial.println("Provisioning started...");
  })
  .onLoop([]() {
    // Animate LEDs while waiting for WiFi connection
    animateLEDs();
  })
  .onSuccess([](const char* ssid, const char* password, const char* input) {
    Serial.printf("Connected to: %s\n", ssid);
    // Turn off animation LEDs before showing streak
    for (int i = 0; i < 7; i++) {
      digitalWrite(LED_PINS[i], LOW);
    }
  })
  .onFactoryReset([]() {
    Serial.println("Factory reset - clearing streak data");
    preferences.begin("streak", false);
    preferences.clear();
    preferences.end();
    streakData = 0;
    todayState = false;
    updateLEDs();
  });

  // Start provisioning (blocks until connected)
  Serial.println("Starting WiFi provisioning...");
  provisioner.startProvisioning();
  Serial.println("Provisioning complete!");

  // Restore streak LEDs after provisioning
  updateLEDs();

  // Sync time after WiFi connects
  syncNTP();
}

void loop() {
  handleButton();
  checkMidnightRollover();
  delay(10);
}

// ============== LED FUNCTIONS ==============

void setupLEDs() {
  for (int i = 0; i < 7; i++) {
    pinMode(LED_PINS[i], OUTPUT);
    digitalWrite(LED_PINS[i], LOW);
  }
}

void updateLEDs() {
  for (int i = 0; i < 7; i++) {
    bool state = (streakData >> i) & 1;
    digitalWrite(LED_PINS[i], state ? HIGH : LOW);
  }
}

void animateLEDs() {
  unsigned long now = millis();
  if (now - lastAnimationTime >= ANIMATION_INTERVAL) {
    lastAnimationTime = now;

    // Turn off all LEDs
    for (int i = 0; i < 7; i++) {
      digitalWrite(LED_PINS[i], LOW);
    }

    // Light up current LED in the sweep (bouncing back and forth)
    // Pattern: 0,1,2,3,4,5,6,5,4,3,2,1,0,1,2...
    int ledIndex;
    int cycle = animationIndex % 12;  // 0-5 going right, 6-11 going left
    if (cycle < 7) {
      ledIndex = cycle;  // 0 to 6
    } else {
      ledIndex = 12 - cycle;  // 5 to 0
    }

    digitalWrite(LED_PINS[ledIndex], HIGH);
    animationIndex++;
  }
}

// ============== BUTTON HANDLING ==============

void handleButton() {
  bool reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY) {
    if (reading == LOW && !buttonPressed) {
      // Button just pressed - toggle today's LED
      buttonPressed = true;
      todayState = !todayState;

      if (todayState) {
        streakData |= (1 << 6);   // Set bit 6 (today)
      } else {
        streakData &= ~(1 << 6);  // Clear bit 6 (today)
      }

      updateLEDs();
      saveStreak();
      sendWebhook(todayState);

      Serial.printf("Today toggled: %s | Streak: ", todayState ? "ON" : "OFF");
      for (int i = 6; i >= 0; i--) {
        Serial.print((streakData >> i) & 1);
      }
      Serial.println();
    } else if (reading == HIGH) {
      buttonPressed = false;
    }
  }

  lastButtonState = reading;
}

// ============== TIME & MIDNIGHT ROLLOVER ==============

void fetchTimezone() {
  Serial.println("Detecting timezone from IP...");

  HTTPClient http;
  http.begin("http://ip-api.com/json/?fields=offset");
  int httpCode = http.GET();

  if (httpCode == HTTP_CODE_OK) {
    String response = http.getString();
    // Response format: {"offset":-18000}
    int offsetStart = response.indexOf(":") + 1;
    int offsetEnd = response.indexOf("}");
    if (offsetStart > 0 && offsetEnd > offsetStart) {
      gmtOffsetSec = response.substring(offsetStart, offsetEnd).toInt();
      Serial.printf("Detected timezone offset: %ld seconds (UTC%+.1f)\n",
                    gmtOffsetSec, gmtOffsetSec / 3600.0);
    }
  } else {
    Serial.printf("Timezone detection failed (HTTP %d), using UTC\n", httpCode);
  }
  http.end();
}

void syncNTP() {
  // First, detect timezone from IP
  fetchTimezone();

  Serial.println("Syncing time with NTP...");
  configTime(gmtOffsetSec, 0, NTP_SERVER);

  // Wait for time to sync (up to 10 seconds)
  int attempts = 0;
  struct tm timeinfo;
  while (!getLocalTime(&timeinfo) && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (getLocalTime(&timeinfo)) {
    ntpSynced = true;
    lastDay = timeinfo.tm_yday;
    Serial.println("\nTime synced!");
    Serial.printf("Current time: %02d:%02d:%02d\n",
                  timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);

    // Check if we need to shift (e.g., device was off for a day)
    preferences.begin("streak", true);
    int savedDay = preferences.getInt("lastDay", -1);
    preferences.end();

    if (savedDay != -1 && savedDay != lastDay) {
      int daysPassed = lastDay - savedDay;
      if (daysPassed < 0) daysPassed += 365; // Handle year wrap

      Serial.printf("Days since last use: %d\n", daysPassed);
      for (int i = 0; i < daysPassed && i < 7; i++) {
        shiftStreak();
      }
      saveStreak();
    }
  } else {
    Serial.println("\nFailed to sync time - using saved state");
  }
}

int getCurrentDay() {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    return timeinfo.tm_yday;
  }
  return -1;
}

void checkMidnightRollover() {
  if (!ntpSynced) return;

  int currentDay = getCurrentDay();
  if (currentDay == -1) return;

  if (lastDay != -1 && currentDay != lastDay) {
    Serial.println("Midnight! Shifting streak...");
    shiftStreak();
    saveStreak();
    lastDay = currentDay;
  }
}

void shiftStreak() {
  // Shift all bits right by 1 (oldest bit falls off, today becomes yesterday)
  streakData = streakData >> 1;
  // Clear today's bit (bit 6) - new day starts fresh
  streakData &= ~(1 << 6);
  todayState = false;
  updateLEDs();

  Serial.print("Streak after shift: ");
  for (int i = 6; i >= 0; i--) {
    Serial.print((streakData >> i) & 1);
  }
  Serial.println();
}

// ============== PERSISTENCE ==============

void loadStreak() {
  preferences.begin("streak", true);  // Read-only
  streakData = preferences.getUChar("data", 0);
  lastDay = preferences.getInt("lastDay", -1);
  preferences.end();

  todayState = (streakData >> 6) & 1;

  Serial.print("Loaded streak: ");
  for (int i = 6; i >= 0; i--) {
    Serial.print((streakData >> i) & 1);
  }
  Serial.println();
}

void saveStreak() {
  preferences.begin("streak", false);  // Read-write
  preferences.putUChar("data", streakData);
  if (lastDay != -1) {
    preferences.putInt("lastDay", lastDay);
  }
  preferences.end();
}

// ============== WEBHOOK ==============

String getMacAddress() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char macStr[18];
  snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(macStr);
}

String getCurrentDate() {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo)) {
    char dateStr[11];
    snprintf(dateStr, sizeof(dateStr), "%04d-%02d-%02d",
             timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday);
    return String(dateStr);
  }
  return "unknown";
}

void sendWebhook(bool state) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Webhook skipped - WiFi not connected");
    return;
  }

  HTTPClient http;
  http.begin(WEBHOOK_URL);
  http.addHeader("Content-Type", "application/json");

  String payload = "{";
  payload += "\"mac\":\"" + getMacAddress() + "\",";
  payload += "\"state\":" + String(state ? "true" : "false") + ",";
  payload += "\"date\":\"" + getCurrentDate() + "\"";
  payload += "}";

  Serial.printf("Sending webhook: %s\n", payload.c_str());

  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    Serial.printf("Webhook response: %d\n", httpCode);
    if (httpCode == HTTP_CODE_OK) {
      String response = http.getString();
      Serial.println(response);
    }
  } else {
    Serial.printf("Webhook failed: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

String generateClaimCode() {
  String mac = WiFi.macAddress();
  mac.replace(":", "");

  // Simple hash: sum bytes and use modulo to create 6 alphanumeric chars
  uint32_t hash = 0;
  for (unsigned int i = 0; i < mac.length(); i++) {
    hash = hash * 31 + mac[i];
  }

  // Mix in more entropy from individual bytes
  for (unsigned int i = 0; i < mac.length(); i += 2) {
    String byteStr = mac.substring(i, i + 2);
    uint8_t b = strtoul(byteStr.c_str(), nullptr, 16);
    hash ^= (b << ((i / 2) * 4));
  }

  const char *chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude I,O,0,1 for readability
  String code = "";
  for (int i = 0; i < 10; i++) {
    code += chars[hash % 32];
    hash /= 32;
  }

  return code;
}
