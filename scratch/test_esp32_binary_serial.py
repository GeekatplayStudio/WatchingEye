import serial
import time

try:
    ser = serial.Serial('COM6', 921600, timeout=0.1)
    print("Reading COM6 @ 921600 baud for USB cable video frames...")

    start = time.time()
    buf = bytearray()
    frame_count = 0

    while time.time() - start < 6:
        chunk = ser.read(2048)
        if chunk:
            buf.extend(chunk)
            while b'#RAW_JPG:' in buf and b'#END_JPG#' in buf:
                start_idx = buf.find(b'#RAW_JPG:')
                end_idx = buf.find(b'#END_JPG#')
                if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                    header_end = buf.find(b'#', start_idx + 9)
                    if header_end != -1 and header_end < end_idx:
                        try:
                            jpg_len = int(buf[start_idx + 9:header_end].decode())
                            jpg_data = buf[header_end + 1:header_end + 1 + jpg_len]
                            frame_count += 1
                            # Check JPEG Magic header 0xFF 0xD8
                            is_valid_jpeg = len(jpg_data) >= 2 and jpg_data[0] == 0xFF and jpg_data[1] == 0xD8
                            print(f"[USB CABLE STREAM] Frame #{frame_count} | Size: {jpg_len} bytes | Valid JPEG Header (0xFFD8): {is_valid_jpeg}")
                        except Exception as e:
                            print(f"Parse error: {e}")
                    buf = buf[end_idx + 9:]
                else:
                    break

    ser.close()
    print(f"\nResult: Captured {frame_count} live USB video frames in 6s.")
except Exception as err:
    print(f"Serial Error: {err}")
