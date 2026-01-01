#!/usr/bin/env python3
"""
Registers the device in Firestore after flashing.
This runs as a PlatformIO post-upload script.

The script:
1. Reads the MAC address from the flashed device
2. Generates the claim code using the same algorithm as the firmware
3. Creates or updates a document in Firestore with the device info
"""

import os
import subprocess
import sys


def get_esptool_path(env):
    """Get the path to esptool.py from PlatformIO environment."""
    platform = env.PioPlatform()
    tool_path = platform.get_package_dir("tool-esptoolpy")
    if tool_path:
        return os.path.join(tool_path, "esptool.py")
    return "esptool.py"


def read_mac_address(env, port):
    """Read MAC address from the connected ESP32 device."""
    esptool = get_esptool_path(env)
    python = sys.executable

    try:
        result = subprocess.run(
            [python, esptool, "--port", port, "read_mac"],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            print(f"ERROR: esptool read_mac failed: {result.stderr}")
            return None

        # Parse MAC address from output
        # Example output: "MAC: aa:bb:cc:dd:ee:ff" (6-byte) or "MAC: aa:bb:cc:ff:fe:dd:ee:ff" (8-byte EUI-64)
        for line in result.stdout.split('\n'):
            if 'MAC:' in line:
                mac = line.split('MAC:')[1].strip()
                # Normalize to uppercase with colons
                mac = mac.upper().replace('-', ':')

                # Check if this is an 8-byte EUI-64 MAC (contains FF:FE in the middle)
                # Convert to 6-byte MAC by removing the FF:FE padding
                parts = mac.split(':')
                if len(parts) == 8 and parts[3] == 'FF' and parts[4] == 'FE':
                    # EUI-64 format: XX:XX:XX:FF:FE:YY:YY:YY -> XX:XX:XX:YY:YY:YY
                    parts = parts[:3] + parts[5:]
                    mac = ':'.join(parts)

                return mac

        print("ERROR: Could not find MAC address in esptool output")
        print(f"Output was: {result.stdout}")
        return None

    except subprocess.TimeoutExpired:
        print("ERROR: Timeout reading MAC address")
        return None
    except Exception as e:
        print(f"ERROR: Failed to read MAC address: {e}")
        return None


def generate_claim_code(mac_address):
    """
    Generate claim code from MAC address.
    This matches the algorithm in main.c generate_claim_code().
    """
    # Remove colons and convert to uppercase
    mac_str = mac_address.replace(':', '').upper()

    # Convert to bytes for the XOR step
    mac_bytes = bytes.fromhex(mac_str)

    # Calculate hash (matching the C algorithm)
    hash_val = 0
    for char in mac_str:
        hash_val = (hash_val * 31 + ord(char)) & 0xFFFFFFFF

    for i in range(6):
        hash_val ^= (mac_bytes[i] << (i * 4))
        hash_val &= 0xFFFFFFFF

    # Generate the 10-character code
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    code = []
    for _ in range(10):
        code.append(chars[hash_val % 32])
        hash_val //= 32

    return ''.join(code)


def register_device_in_firestore(mac_address, claim_code, project_dir=None):
    """Create or update device document in Firestore."""
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        print("\nERROR: firebase-admin package not installed.")
        print("Install with: pip install firebase-admin")
        return False

    # Initialize Firebase if not already done
    if not firebase_admin._apps:
        # Look for service account key in common locations
        # Use project_dir if provided (from PlatformIO env), otherwise try __file__
        if project_dir:
            script_dir = project_dir
        else:
            script_dir = os.path.dirname(os.path.abspath(__file__))

        possible_paths = [
            os.path.join(script_dir, "serviceAccountKey.json"),
            os.path.join(script_dir, "..", "client", "serviceAccountKey.json"),
            os.path.expanduser("~/.config/firebase/serviceAccountKey.json"),
        ]

        # Also check GOOGLE_APPLICATION_CREDENTIALS env var
        env_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if env_path:
            possible_paths.insert(0, env_path)

        cred_path = None
        for path in possible_paths:
            if os.path.exists(path):
                cred_path = path
                break

        if not cred_path:
            print("\nERROR: Could not find Firebase service account key.")
            print("Please either:")
            print("  1. Set GOOGLE_APPLICATION_CREDENTIALS environment variable")
            print("  2. Place serviceAccountKey.json in the firmware directory")
            print("  3. Place serviceAccountKey.json in the client directory")
            return False

        try:
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
            print(f"Firebase initialized with: {cred_path}")
        except Exception as e:
            print(f"ERROR: Failed to initialize Firebase: {e}")
            return False

    db = firestore.client()

    # Check if device already exists by MAC address
    devices_ref = db.collection("devices")
    query = devices_ref.where("macAddress", "==", mac_address).limit(1)
    existing_docs = list(query.stream())

    if existing_docs:
        # Update existing document
        doc_ref = existing_docs[0].reference
        doc_ref.update({
            "claimCode": claim_code,
            "macAddress": mac_address,
        })
        print(f"Updated existing device: {doc_ref.id}")
    else:
        # Create new document with auto-generated ID
        doc_ref = devices_ref.add({
            "claimCode": claim_code,
            "macAddress": mac_address,
        })
        print(f"Created new device: {doc_ref[1].id}")

    return True


def register_device(source, target, env):
    """Post-upload action to register device in Firestore."""
    print("\n" + "=" * 60)
    print("DEVICE REGISTRATION")
    print("=" * 60)

    # Get upload port
    port = env.get("UPLOAD_PORT")
    if not port:
        # Try to auto-detect
        from platformio.device.list import list_serial_ports
        ports = list_serial_ports()
        if ports:
            port = ports[0]["port"]
        else:
            print("ERROR: No serial port found")
            print("=" * 60 + "\n")
            return

    # Read MAC address
    print(f"Reading MAC address from port: {port}")
    mac_address = read_mac_address(env, port)

    if not mac_address:
        print("Failed to read MAC address, skipping registration")
        print("=" * 60 + "\n")
        return

    print(f"MAC Address: {mac_address}")

    # Generate claim code
    claim_code = generate_claim_code(mac_address)
    print(f"Claim Code:  {claim_code}")

    # Register in Firestore
    print("\nRegistering device in Firestore...")
    project_dir = env.subst("$PROJECT_DIR")
    if register_device_in_firestore(mac_address, claim_code, project_dir):
        print("\nSUCCESS: Device registered!")
    else:
        print("\nWARNING: Failed to register device in Firestore")
        print("The device will still work, but won't be claimable until registered.")

    print("=" * 60 + "\n")


# PlatformIO integration
try:
    from SCons.Script import Import
    Import("env")
    env = env  # noqa: F821

    # Register post-upload action
    env.AddPostAction("upload", register_device)
    print("Device registration script registered (post-upload)")

except (ImportError, Exception):
    # Not running under PlatformIO/SCons - allow standalone testing
    if __name__ == "__main__":
        # Test the claim code generation
        test_mac = "AA:BB:CC:DD:EE:FF"
        print(f"Test MAC: {test_mac}")
        print(f"Claim Code: {generate_claim_code(test_mac)}")
