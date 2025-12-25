#!/usr/bin/env python3
"""
Burns the HMAC key to eFuse after flashing.
This runs as a PlatformIO post-upload script.

The key is only burned if:
1. hmac_key.bin exists in the project root
2. The eFuse block is not already programmed

IMPORTANT: eFuse burning is PERMANENT and IRREVERSIBLE!
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


def get_espefuse_path(env):
    """Get the path to espefuse.py from PlatformIO environment."""
    platform = env.PioPlatform()
    tool_path = platform.get_package_dir("tool-esptoolpy")
    if tool_path:
        return os.path.join(tool_path, "espefuse.py")
    return "espefuse.py"


def check_key_already_burned(env, port):
    """Check if the HMAC key block is already programmed."""
    espefuse = get_espefuse_path(env)
    python = sys.executable

    try:
        result = subprocess.run(
            [python, espefuse, "--port", port, "summary"],
            capture_output=True,
            text=True,
            timeout=30
        )

        # Look for BLOCK_KEY4 status
        for line in result.stdout.split('\n'):
            if 'BLOCK_KEY4' in line:
                # Check if it shows as programmed (not all zeros or "= 0")
                if 'KEY_PURPOSE_4' in line or '= 0 R/W' not in line:
                    # Check purpose field
                    pass
            if 'KEY_PURPOSE_4' in line:
                if 'HMAC_UP' in line:
                    print("HMAC key already burned with correct purpose (HMAC_UP)")
                    return True
                # USER (0x0) means unused/available - this is fine to program
                # Only block if it's set to a different non-default purpose
                elif 'USER' not in line and '= 0' not in line and 'NONE' not in line:
                    print(f"WARNING: KEY_PURPOSE_4 already set to different purpose: {line.strip()}")
                    return True

        # Also check if the key block has data
        for line in result.stdout.split('\n'):
            if 'BLOCK_KEY4' in line and '= 00 00 00' not in line and '= 0 ' not in line:
                if 'R/-' in line or 'R/W' in line:
                    # Block has some data
                    if '00 00 00 00 00 00 00 00' not in line:
                        print("BLOCK_KEY4 appears to already have data programmed")
                        return True

        return False

    except subprocess.TimeoutExpired:
        print("WARNING: Timeout checking eFuse status")
        return True  # Assume burned to be safe
    except Exception as e:
        print(f"WARNING: Could not check eFuse status: {e}")
        return True  # Assume burned to be safe


def burn_hmac_key(source, target, env):
    """Post-upload action to burn HMAC key to eFuse."""
    # Get project directory from PlatformIO environment
    project_dir = env.subst("$PROJECT_DIR")
    key_path = os.path.join(project_dir, "hmac_key.bin")

    # Check if key file exists
    if not os.path.exists(key_path):
        print("\n" + "=" * 60)
        print("HMAC key file not found: hmac_key.bin")
        print("Skipping eFuse burn. Device will work without HMAC signing.")
        print("=" * 60 + "\n")
        return

    # Validate key file size
    key_size = os.path.getsize(key_path)
    if key_size != 32:
        print(f"\nERROR: hmac_key.bin must be exactly 32 bytes, got {key_size} bytes")
        return

    # Get upload port
    port = env.get("UPLOAD_PORT")
    if not port:
        # Try to auto-detect
        from platformio.device.list import list_serial_ports
        ports = list_serial_ports()
        if ports:
            port = ports[0]["port"]
        else:
            print("\nERROR: No serial port found for eFuse burning")
            return

    print("\n" + "=" * 60)
    print("HMAC KEY EFUSE PROGRAMMING")
    print("=" * 60)

    # Check if already burned
    if check_key_already_burned(env, port):
        print("eFuse BLOCK_KEY4 already programmed, skipping burn.")
        print("=" * 60 + "\n")
        return

    print(f"Key file: {key_path}")
    print(f"Port: {port}")
    print("\nWARNING: eFuse burning is PERMANENT and IRREVERSIBLE!")
    print("Burning HMAC key to BLOCK_KEY4 with purpose HMAC_UP...")

    espefuse = get_espefuse_path(env)
    python = sys.executable

    try:
        # Burn the key with --do-not-confirm for automation
        result = subprocess.run(
            [
                python, espefuse,
                "--port", port,
                "--do-not-confirm",
                "burn_key", "BLOCK_KEY4", key_path, "HMAC_UP"
            ],
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode == 0:
            print("\nSUCCESS: HMAC key burned to eFuse!")
            print("The device will now sign webhook requests.")
        else:
            print(f"\neFuse burn failed with code {result.returncode}")
            print(f"stdout: {result.stdout}")
            print(f"stderr: {result.stderr}")

    except subprocess.TimeoutExpired:
        print("\nERROR: eFuse burn timed out")
    except Exception as e:
        print(f"\nERROR: eFuse burn failed: {e}")

    print("=" * 60 + "\n")


# PlatformIO integration
try:
    from SCons.Script import Import
    Import("env")
    env = env  # noqa: F821

    # Register post-upload action
    env.AddPostAction("upload", burn_hmac_key)
    print("HMAC eFuse burn script registered (post-upload)")

except (ImportError, Exception):
    # Not running under PlatformIO/SCons
    pass
