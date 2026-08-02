#include "esp_camera.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <Update.h>
#include "esp_http_server.h"
#include <SD_MMC.h>

// -------------------------------------------------------------------
// FREENOVE ESP32-S3 CAM PIN & DIM RGB LED CONFIGURATION
// FNK0085 Official Pinout Reference
// -------------------------------------------------------------------
#define PWDN_GPIO_NUM  -1
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM  15
#define SIOD_GPIO_NUM  4
#define SIOC_GPIO_NUM  5

#define Y9_GPIO_NUM    16
#define Y8_GPIO_NUM    17
#define Y7_GPIO_NUM    18
#define Y6_GPIO_NUM    12
#define Y5_GPIO_NUM    10
#define Y4_GPIO_NUM    8
#define Y3_GPIO_NUM    9
#define Y2_GPIO_NUM    11
#define VSYNC_GPIO_NUM 6
#define HREF_GPIO_NUM  7
#define PCLK_GPIO_NUM  13

#define RGB_LED_PIN    48
#define LED_PIN        2

// Camera Name & Wi-Fi Credentials
String cameraName = "FREENOVE_CAM_NODE_1";
String wifiSsid = "vcode";
String wifiPass = "Shm0vk1n";

const char* ap_ssid = "WatchingEye_CAM_AP";
const char* ap_password = "watchingeye123";

httpd_handle_t stream_httpd = NULL;
httpd_handle_t camera_httpd = NULL;

bool cameraReady = false;
bool sdCardReady = false;
bool wifiConnected = false;
bool triggerActive = false;
bool recordingActive = false;
unsigned long frameCounter = 0;

// Ultra-Dim RGB LED Controller (5% Brightness, Zero Rapid Cycling)
void setDimRgbColor(uint8_t r, uint8_t g, uint8_t b) {
  uint8_t dimR = (r * 15) / 255;
  uint8_t dimG = (g * 15) / 255;
  uint8_t dimB = (b * 15) / 255;

#ifdef RGB_BUILTIN
  neopixelWrite(RGB_BUILTIN, dimR, dimG, dimB);
#else
  neopixelWrite(RGB_LED_PIN, dimR, dimG, dimB);
#endif
}

void updateLedStatus() {
  static int lastState = -1;
  int currentState = 0;

  if (recordingActive) {
    currentState = 4; // Dim Blue
  } else if (triggerActive) {
    currentState = 3; // Dim Amber
  } else if (wifiConnected && cameraReady) {
    currentState = 2; // Dim Soft Green
  } else if (wifiConnected) {
    currentState = 1; // Dim Purple
  } else {
    currentState = 0; // Dim Red
  }

  if (currentState != lastState) {
    lastState = currentState;
    switch (currentState) {
      case 0: setDimRgbColor(255, 0, 0); break;
      case 1: setDimRgbColor(180, 0, 255); break;
      case 2: setDimRgbColor(0, 255, 120); break;
      case 3: setDimRgbColor(255, 200, 0); break;
      case 4: setDimRgbColor(0, 100, 255); break;
    }
  }
}

// High-Performance Espressif HTTP MJPEG Stream Handler
static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;
  char part_buf[128];

  res = httpd_resp_set_type(req, "multipart/x-mixed-replace; boundary=frame");
  if (res != ESP_OK) return res;
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  while (true) {
    if (!cameraReady) {
      vTaskDelay(20 / portTICK_PERIOD_MS);
      continue;
    }
    fb = esp_camera_fb_get();
    if (!fb) {
      vTaskDelay(10 / portTICK_PERIOD_MS);
      continue;
    }
    size_t hlen = snprintf(part_buf, 128, "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", (unsigned int)fb->len);
    res = httpd_resp_send_chunk(req, part_buf, hlen);
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, "\r\n", 2);
    }
    esp_camera_fb_return(fb);
    if (res != ESP_OK) break;
    frameCounter++;
  }
  return res;
}

// Single Snapshot Handler
static esp_err_t capture_handler(httpd_req_t *req) {
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }
  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

// Official Espressif Camera Settings Controller Endpoint (/control?var=...&val=...)
static esp_err_t cmd_handler(httpd_req_t *req) {
  char* buf;
  size_t buf_len;
  char variable[32] = {0,};
  char value[32] = {0,};

  buf_len = httpd_req_get_url_query_len(req) + 1;
  if (buf_len > 1) {
    buf = (char*)malloc(buf_len);
    if (!buf) {
      httpd_resp_send_500(req);
      return ESP_FAIL;
    }
    if (httpd_req_get_url_query_str(req, buf, buf_len) == ESP_OK) {
      if (httpd_query_key_value(buf, "var", variable, sizeof(variable)) == ESP_OK &&
          httpd_query_key_value(buf, "val", value, sizeof(value)) == ESP_OK) {
      } else {
        free(buf);
        httpd_resp_send_404(req);
        return ESP_FAIL;
      }
    }
    free(buf);
  } else {
    httpd_resp_send_404(req);
    return ESP_FAIL;
  }

  int val = atoi(value);
  sensor_t * s = esp_camera_sensor_get();
  int res = 0;

  if(!strcmp(variable, "framesize")) {
    if(s->pixformat == PIXFORMAT_JPEG) res = s->set_framesize(s, (framesize_t)val);
  }
  else if(!strcmp(variable, "quality")) res = s->set_quality(s, val);
  else if(!strcmp(variable, "contrast")) res = s->set_contrast(s, val);
  else if(!strcmp(variable, "brightness")) res = s->set_brightness(s, val);
  else if(!strcmp(variable, "saturation")) res = s->set_saturation(s, val);
  else if(!strcmp(variable, "gainceiling")) res = s->set_gainceiling(s, (gainceiling_t)val);
  else if(!strcmp(variable, "colorbar")) res = s->set_colorbar(s, val);
  else if(!strcmp(variable, "awb")) res = s->set_whitebal(s, val);
  else if(!strcmp(variable, "agc")) res = s->set_gain_ctrl(s, val);
  else if(!strcmp(variable, "aec")) res = s->set_exposure_ctrl(s, val);
  else if(!strcmp(variable, "hmirror")) res = s->set_hmirror(s, val);
  else if(!strcmp(variable, "vflip")) res = s->set_vflip(s, val);
  else if(!strcmp(variable, "awb_gain")) res = s->set_awb_gain(s, val);
  else if(!strcmp(variable, "agc_gain")) res = s->set_agc_gain(s, val);
  else if(!strcmp(variable, "aec_value")) res = s->set_aec_value(s, val);
  else if(!strcmp(variable, "aec2")) res = s->set_aec2(s, val);
  else if(!strcmp(variable, "dcw")) res = s->set_dcw(s, val);
  else if(!strcmp(variable, "bpc")) res = s->set_bpc(s, val);
  else if(!strcmp(variable, "wpc")) res = s->set_wpc(s, val);
  else if(!strcmp(variable, "raw_gma")) res = s->set_raw_gma(s, val);
  else if(!strcmp(variable, "lenc")) res = s->set_lenc(s, val);
  else if(!strcmp(variable, "special_effect")) res = s->set_special_effect(s, val);
  else if(!strcmp(variable, "wb_mode")) res = s->set_wb_mode(s, val);
  else if(!strcmp(variable, "ae_level")) res = s->set_ae_level(s, val);
  else {
    res = -1;
  }

  if(res) {
    return httpd_resp_send_500(req);
  }

  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  return httpd_resp_send(req, NULL, 0);
}

// Camera Sensor Status JSON Endpoint (/status)
static esp_err_t status_handler(httpd_req_t *req) {
  static char json_response[1024];
  sensor_t * s = esp_camera_sensor_get();
  if(!s) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }
  char * p = json_response;
  *p++ = '{';
  p += sprintf(p, "\"framesize\":%u,", s->status.framesize);
  p += sprintf(p, "\"quality\":%u,", s->status.quality);
  p += sprintf(p, "\"brightness\":%d,", s->status.brightness);
  p += sprintf(p, "\"contrast\":%d,", s->status.contrast);
  p += sprintf(p, "\"saturation\":%d,", s->status.saturation);
  p += sprintf(p, "\"special_effect\":%u,", s->status.special_effect);
  p += sprintf(p, "\"whitebal\":%u,", s->status.awb);
  p += sprintf(p, "\"awb_gain\":%u,", s->status.awb_gain);
  p += sprintf(p, "\"wb_mode\":%u,", s->status.wb_mode);
  p += sprintf(p, "\"aec\":%u,", s->status.aec);
  p += sprintf(p, "\"aec2\":%u,", s->status.aec2);
  p += sprintf(p, "\"ae_level\":%d,", s->status.ae_level);
  p += sprintf(p, "\"aec_value\":%u,", s->status.aec_value);
  p += sprintf(p, "\"agc\":%u,", s->status.agc);
  p += sprintf(p, "\"agc_gain\":%u,", s->status.agc_gain);
  p += sprintf(p, "\"gainceiling\":%u,", s->status.gainceiling);
  p += sprintf(p, "\"bpc\":%u,", s->status.bpc);
  p += sprintf(p, "\"wpc\":%u,", s->status.wpc);
  p += sprintf(p, "\"raw_gma\":%u,", s->status.raw_gma);
  p += sprintf(p, "\"lenc\":%u,", s->status.lenc);
  p += sprintf(p, "\"hmirror\":%u,", s->status.hmirror);
  p += sprintf(p, "\"vflip\":%u,", s->status.vflip);
  p += sprintf(p, "\"dcw\":%u,", s->status.dcw);
  p += sprintf(p, "\"colorbar\":%u,", s->status.colorbar);
  p += sprintf(p, "\"ota_ready\":true");
  *p++ = '}';
  *p++ = 0;
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  return httpd_resp_send(req, json_response, strlen(json_response));
}

// HTTP Web OTA Firmware Upload Handler (/update)
static esp_err_t update_post_handler(httpd_req_t *req) {
  char buf[1024];
  int received;
  int remaining = req->content_len;
  bool is_update_started = false;

  while (remaining > 0) {
    if ((received = httpd_req_recv(req, buf, min(remaining, (int)sizeof(buf)))) <= 0) {
      if (received == HTTPD_SOCK_ERR_TIMEOUT) {
        continue;
      }
      return ESP_FAIL;
    }

    if (!is_update_started) {
      if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
        Update.printError(Serial);
        return httpd_resp_send_500(req);
      }
      is_update_started = true;
    }

    if (Update.write((uint8_t *)buf, received) != (size_t)received) {
      Update.printError(Serial);
      return httpd_resp_send_500(req);
    }

    remaining -= received;
  }

  if (Update.end(true)) {
    Serial.println("#TEL:OTA:Web Update Finished Successfully! Rebooting...");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_send(req, "OK", 2);
    vTaskDelay(1000 / portTICK_PERIOD_MS);
    ESP.restart();
    return ESP_OK;
  } else {
    Update.printError(Serial);
    return httpd_resp_send_500(req);
  }
}

// Identity Info Endpoint (/api/info)
static esp_err_t info_handler(httpd_req_t *req) {
  String json = "{\"name\":\"" + cameraName + "\","
                "\"board\":\"Freenove ESP32-S3 CAM\","
                "\"ssid\":\"" + wifiSsid + "\","
                "\"ip\":\"" + (wifiConnected ? WiFi.localIP().toString() : WiFi.softAPIP().toString()) + "\","
                "\"rssi\":" + String(WiFi.RSSI()) + ","
                "\"ota\":true,"
                "\"otaPort\":3232,"
                "\"updateUrl\":\"http://" + (wifiConnected ? WiFi.localIP().toString() : WiFi.softAPIP().toString()) + "/update\","
                "\"streamUrl\":\"http://" + (wifiConnected ? WiFi.localIP().toString() : WiFi.softAPIP().toString()) + ":81/stream\"}";
  httpd_resp_set_type(req, "application/json");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  return httpd_resp_send(req, json.c_str(), json.length());
}

// Start Native ESP32 HTTP Stream & Control Servers
void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 81;
  config.ctrl_port = 81;

  httpd_uri_t stream_uri = {
    .uri       = "/stream",
    .method    = HTTP_GET,
    .handler   = stream_handler,
    .user_ctx  = NULL
  };

  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &stream_uri);
    Serial.println("#TEL:STREAM_SERVER:OK Port 81 Started (/stream)");
  }

  httpd_config_t main_config = HTTPD_DEFAULT_CONFIG();
  main_config.server_port = 80;
  main_config.ctrl_port = 80;

  httpd_uri_t capture_uri = { .uri = "/capture", .method = HTTP_GET,  .handler = capture_handler,    .user_ctx = NULL };
  httpd_uri_t control_uri = { .uri = "/control", .method = HTTP_GET,  .handler = cmd_handler,        .user_ctx = NULL };
  httpd_uri_t status_uri  = { .uri = "/status",  .method = HTTP_GET,  .handler = status_handler,     .user_ctx = NULL };
  httpd_uri_t update_uri  = { .uri = "/update",  .method = HTTP_POST, .handler = update_post_handler, .user_ctx = NULL };
  httpd_uri_t info_uri    = { .uri = "/api/info",.method = HTTP_GET,  .handler = info_handler,       .user_ctx = NULL };

  if (httpd_start(&camera_httpd, &main_config) == ESP_OK) {
    httpd_register_uri_handler(camera_httpd, &capture_uri);
    httpd_register_uri_handler(camera_httpd, &control_uri);
    httpd_register_uri_handler(camera_httpd, &status_uri);
    httpd_register_uri_handler(camera_httpd, &update_uri);
    httpd_register_uri_handler(camera_httpd, &info_uri);
    Serial.println("#TEL:WEB_SERVER:OK Port 80 Started (/capture, /control, /status, /update, /api/info)");
  }
}

// Core 0 Task for USB Serial Video Stream
void usbVideoTask(void * pvParameters) {
  for (;;) {
    if (cameraReady) {
      camera_fb_t * fb = esp_camera_fb_get();
      if (fb) {
        Serial.printf("#RAW_JPG:%u#", fb->len);
        Serial.write(fb->buf, fb->len);
        Serial.println("#END_JPG#");
        esp_camera_fb_return(fb);
      }
    }
    vTaskDelay(66 / portTICK_PERIOD_MS);
  }
}

void setup() {
  Serial.begin(921600);
  Serial.setDebugOutput(false);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  setDimRgbColor(255, 0, 0);

  Serial.println("\n#TEL:BOOT:Freenove ESP32-S3 Camera Booting...");

  // Official Freenove ESP32-S3 CAM Camera Configuration
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    Serial.println("#TEL:PSRAM:8MB Octal PSRAM OK");
    config.frame_size = FRAMESIZE_VGA;
    config.jpeg_quality = 10;
    config.fb_count = 2;
    config.grab_mode = CAMERA_GRAB_LATEST;
    config.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    Serial.println("#TEL:PSRAM:No PSRAM");
    config.frame_size = FRAMESIZE_QVGA;
    config.jpeg_quality = 14;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
  }

  // Camera Init
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("#TEL:ERROR:Camera Init Failed 0x%x\n", err);
    return;
  }
  cameraReady = true;

  // Sensor Initialization
  sensor_t * s = esp_camera_sensor_get();
  if (s != NULL) {
    s->set_brightness(s, 0);
    s->set_contrast(s, 0);
    s->set_saturation(s, 0);
    s->set_special_effect(s, 0);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_wb_mode(s, 0);
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 0);
    s->set_ae_level(s, 0);
    s->set_aec_value(s, 300);
    s->set_gain_ctrl(s, 1);
    s->set_agc_gain(s, 0);
    s->set_gainceiling(s, (gainceiling_t)0);
    s->set_bpc(s, 0);
    s->set_wpc(s, 1);
    s->set_raw_gma(s, 1);
    s->set_lenc(s, 1);
    s->set_hmirror(s, 0);
    s->set_vflip(s, 0);
    s->set_dcw(s, 1);
    s->set_colorbar(s, 0);
  }

  Serial.println("#TEL:CAMERA:OK Camera Sensor Initialized");

  // Mount MicroSD Card
  if (SD_MMC.begin("/sdcard", true)) {
    sdCardReady = true;
    Serial.println("#TEL:SDCARD:OK (/sdcard/events)");
    SD_MMC.mkdir("/sdcard/events");
  } else {
    Serial.println("#TEL:SDCARD:WARN Not Mounted");
  }

  // Wi-Fi AP + STA Setup
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(ap_ssid, ap_password);
  WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());

  Serial.printf("#TEL:WIFI_AP:READY SSID:%s IP:%s\n", ap_ssid, WiFi.softAPIP().toString().c_str());
  Serial.printf("#TEL:WIFI_STA:CONNECTING to SSID '%s'...\n", wifiSsid.c_str());

  // ArduinoOTA Setup (Port 3232 Wireless Remote Flashing)
  ArduinoOTA.setHostname("watchingeye-cam1");
  ArduinoOTA.setPassword("watchingeye123");

  ArduinoOTA.onStart([]() {
    Serial.println("#TEL:OTA:Wireless Firmware Update Started...");
    setDimRgbColor(255, 250, 0); // Dim Yellow for OTA Update
  });
  ArduinoOTA.onEnd([]() {
    Serial.println("\n#TEL:OTA:Wireless Firmware Update Completed!");
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("#TEL:OTA:Progress %u%%\r", (progress / (total / 100)));
  });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("#TEL:OTA:Error[%u]\n", error);
  });

  ArduinoOTA.begin();
  Serial.println("#TEL:OTA:OK Wireless OTA Enabled on Port 3232");

  // Register mDNS domain
  if (MDNS.begin("watchingeye-cam1")) {
    MDNS.addService("watchingeye", "tcp", 81);
    MDNS.addService("arduino", "tcp", 3232);
    Serial.println("#TEL:MDNS:OK Domain watchingeye-cam1.local registered");
  }

  // Start HTTP Native Camera Servers
  startCameraServer();

  // Pin USB Cable Video Stream to Core 0
  xTaskCreatePinnedToCore(
    usbVideoTask,
    "usbVideoTask",
    4096,
    NULL,
    1,
    NULL,
    0
  );
}

void loop() {
  // Handle Wireless OTA Flashing Calls
  ArduinoOTA.handle();

  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiConnected) {
      wifiConnected = true;
      Serial.printf("\n#TEL:WIFI_STA:CONNECTED! Router IP: %s (SSID: %s, RSSI: %d dBm)\n",
                    WiFi.localIP().toString().c_str(),
                    wifiSsid.c_str(),
                    WiFi.RSSI());
      Serial.printf("#TEL:STREAM_URL:http://%s:81/stream\n", WiFi.localIP().toString().c_str());
    }
  } else {
    if (wifiConnected) {
      wifiConnected = false;
      Serial.println("\n#TEL:WIFI_STA:DISCONNECTED");
    }
  }

  updateLedStatus();
  vTaskDelay(200 / portTICK_PERIOD_MS);
}
