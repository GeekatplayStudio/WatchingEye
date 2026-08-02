# Freenove FNK0085 ESP32-S3 CAM Technical Reference & Remote OTA Guide

Source: https://docs.freenove.com/projects/fnk0085/en/latest/fnk0085/codes/C.html

## Hardware Specifications
- **Microcontroller**: ESP32-S3 WROOM (Dual-core 240 MHz, LX7)
- **Flash Memory**: 16 MB SPI Flash
- **PSRAM**: 8 MB Octal PSRAM (`AP_3v3`)
- **USB Interface**: WCH CH343 USB-to-Serial (`COM6 @ 921600 baud`)
- **Wi-Fi Subnet**: Bridges 2.4 GHz ESP32-S3 card to 5 GHz PC on Mesh router (`vcode` @ `192.168.4.x`)

---

## Wireless Over-The-Air (OTA) Remote Firmware Flashing

The Freenove ESP32-S3 CAM is configured with **Dual Wireless OTA**. You can disconnect the USB cable and power the board anywhere via 5V USB wall adapter or battery pack!

### Method 1: ArduinoOTA Wireless Upload (Port 3232)
Compile and upload wirelessly over Wi-Fi without USB:
```bash
# 1. Compile the firmware binary
arduino-cli compile --fqbn esp32:esp32:esp32s3:FlashSize=16M,PSRAM=opi firmware\esp32s3_cam_watchingeye\esp32s3_cam_watchingeye.ino

# 2. Upload wirelessly over Wi-Fi to IP 192.168.4.24 on Port 3232
python -m espota -i 192.168.4.24 -p 3232 -a watchingeye123 -f firmware/esp32s3_cam_watchingeye/build/esp32.esp32.esp32s3/esp32s3_cam_watchingeye.ino.bin
```

### Method 2: Web HTTP OTA Upload (`http://192.168.4.24/update`)
Post the compiled binary directly over HTTP using cURL or Python:
```bash
curl -F "file=@firmware.bin" http://192.168.4.24/update
```

---

## Official Pinout Mapping

### Camera Pins (OV2640 / OV5640)
- `PWDN_GPIO_NUM`  = -1
- `RESET_GPIO_NUM` = -1
- `XCLK_GPIO_NUM`  = 15
- `SIOD_GPIO_NUM`   = 4 (SDA)
- `SIOC_GPIO_NUM`   = 5 (SCL)
- `Y9_GPIO_NUM`    = 16
- `Y8_GPIO_NUM`    = 17
- `Y7_GPIO_NUM`    = 18
- `Y6_GPIO_NUM`    = 12
- `Y5_GPIO_NUM`    = 10
- `Y4_GPIO_NUM`    = 8
- `Y3_GPIO_NUM`    = 9
- `Y2_GPIO_NUM`    = 11
- `VSYNC_GPIO_NUM` = 6
- `HREF_GPIO_NUM`  = 7
- `PCLK_GPIO_NUM`   = 13

### Onboard Status LEDs & Ultra-Dim Controls
- **Indicator LED**: GPIO 2
- **WS2812 RGB LED**: GPIO 48 (`RGB_BUILTIN`)
- **Status Colors (5% Dim Glow)**:
  - 🟣 **Dim Purple**: Connected to Router `vcode` (`192.168.4.24`)
  - 🟢 **Dim Soft Green**: Connected & Streaming Live (`http://192.168.4.24:81/stream`)
  - 🟡 **Dim Amber**: Target Event Triggered
  - 🔵 **Dim Blue**: MicroSD Recording Active
  - 🟡 **Dim Yellow**: Wireless OTA Flashing In Progress

### MicroSD Card (SDMMC 1-Bit Mode)
- `CLK` = GPIO 39
- `CMD` = GPIO 38
- `D0`  = GPIO 40
