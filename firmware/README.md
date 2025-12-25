# PressIt Firmware

ESP32-C6 firmware for the PressIt streak tracker button.

## Prerequisites

- [PlatformIO](https://platformio.org/install) (VS Code extension or CLI)
- Python 3.9+

## Quick Start

1. **Install Python dependencies** (required for eFuse burning):

   ```powershell
   cd firmware
   ~/.platformio/penv/Scripts/pip.exe install cryptography ecdsa bitstring reedsolo
   ```

2. **Build and upload**:

   ```powershell
   pio run -t upload
   ```

3. **Monitor serial output**:

   ```powershell
   pio device monitor
   ```

## HMAC Signing Setup

The firmware supports hardware HMAC-SHA256 signing using the ESP32-C6's eFuse-protected key.

### Generate HMAC Key

```powershell
# Generate 32 random bytes
dd if=/dev/urandom of=hmac_key.bin bs=32 count=1

# Display hex
xxd -p hmac_key.bin | tr -d '\n'
```

**Important**: Save this key securely! You'll need it for both the device and Firebase.

### Burn Key to Device

The key is automatically burned to eFuse when you upload firmware, if `hmac_key.bin` exists in the firmware directory.

```powershell
pio run -t upload
```

You'll see output like:

```
============================================================
HMAC KEY EFUSE PROGRAMMING
============================================================
Key file: C:\...\firmware\hmac_key.bin
Port: COM5

WARNING: eFuse burning is PERMANENT and IRREVERSIBLE!
Burning HMAC key to BLOCK_KEY4 with purpose HMAC_UP...

SUCCESS: HMAC key burned to eFuse!
============================================================
```

**Warning**: eFuse burning is permanent! The key cannot be changed after burning.

### Configure Firebase

1. Set the secret in Firebase:

   ```bash
   cd ../client
   firebase functions:secrets:set HMAC_SECRET
   # Paste the hex key when prompted
   ```

2. Deploy the function:

   ```bash
   firebase deploy --only functions:buttonPress
   ```

### Verify HMAC is Working

After the device boots, check the serial output:

```
----------------------------------------
MAC Address:  AA:BB:CC:DD:EE:FF
Claim Code:   ABCD123456
HMAC Signing: ENABLED
----------------------------------------
```

When a button press is sent:

```
Sending webhook: {"mac":"AA:BB:CC:DD:EE:FF","state":true,"date":"2025-01-15","timestamp":1234567890}
Request signed with hardware HMAC
Webhook response: 200
```

## Project Structure

```
firmware/
├── src/
│   ├── main.c              # Main application
│   ├── captive_portal.html # WiFi setup UI
│   └── captive_portal.h    # Auto-generated from HTML
├── platformio.ini          # PlatformIO configuration
├── partitions.csv          # Flash partition table
├── burn_hmac_key.py        # eFuse burning script (post-upload)
├── html_to_header.py       # HTML to C header converter (pre-build)
├── hmac_key.bin            # HMAC key (not in git!)
└── pyproject.toml          # Python dependencies
```

## How It Works

1. **WiFi Provisioning**: On first boot, creates an AP "The thing Will gave me". Connect and configure WiFi via the captive portal.

2. **Time Sync**: Fetches timezone from IP geolocation, then syncs time via NTP.

3. **Button Press**: Toggles today's streak state and sends a signed webhook to Firebase.

4. **Midnight Rollover**: Automatically shifts streak data at midnight.

5. **Factory Reset**: Hold the BOOT button for 5 seconds to clear all data.

## Troubleshooting

### HMAC Key Not Available

If you see `HMAC Signing: DISABLED`, the eFuse key wasn't burned. Check:

- `hmac_key.bin` exists and is exactly 32 bytes
- The eFuse wasn't already programmed with a different key

### Webhook Returns 401

- Verify the Firebase secret matches the device key
- Check device time is synced (timestamp drift > 5 minutes will fail)
- Ensure the function was redeployed after setting the secret

### Can't Connect to WiFi

Hold BOOT button for 5 seconds to factory reset, then reconfigure via the captive portal.
