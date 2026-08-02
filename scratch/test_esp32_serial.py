import serial
import time

try:
    ser = serial.Serial('COM6', 921600, timeout=1)
    print("Connected to ESP32-S3 on COM6 @ 921600 baud")

    start_time = time.time()
    img_count = 0
    telemetry_logs = []

    while time.time() - start_time < 5:
        line = ser.readline()
        if not line:
            continue
        try:
            decoded = line.decode('utf-8', errors='ignore').strip()
            if decoded.startswith('#TEL:'):
                print(f"[ESP32 TELEMETRY] {decoded}")
                telemetry_logs.append(decoded)
            elif decoded.startswith('#IMG:'):
                img_count += 1
                print(f"[USB VIDEO FRAME #{img_count}] Received frame header: {decoded[:30]}...")
        except Exception as e:
            pass

    ser.close()
    print(f"\nSummary: Received {img_count} USB Video Frames over COM6 cable in 5s.")
except Exception as err:
    print(f"Serial Error: {err}")
