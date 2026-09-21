#include <Arduino.h>
#include <bluefruit.h>
#include <LSM6DS3.h>

LSM6DS3 myIMU(I2C_MODE, 0x6A);

// 確保 Service UUID 與網頁端 100% 一致 (19b10000)
BLEService        tennisService("19B10000-E8F2-537E-4F6C-D104768A1214");
BLECharacteristic impactCharacteristic("19B10011-E8F2-537E-4F6C-D104768A1214");

const float IMPACT_THRESHOLD = 3.5; 
float trackedRacketAngle = 0.0f;
uint32_t lastOrientationMicros = 0;
bool orientationInitialized = false;

float updateRacketAngle(float ax, float ay, float az, float gyroX) {
  uint32_t now = micros();
  float accelAngle = atan2(ay, az) * 180.0f / PI;

  if (!orientationInitialized) {
    trackedRacketAngle = accelAngle;
    lastOrientationMicros = now;
    orientationInitialized = true;
    return trackedRacketAngle;
  }

  float deltaSeconds = (now - lastOrientationMicros) / 1000000.0f;
  lastOrientationMicros = now;
  trackedRacketAngle += gyroX * deltaSeconds;

  float totalG = sqrt(ax * ax + ay * ay + az * az);
  if (totalG > 0.8f && totalG < 1.2f) {
    float correction = accelAngle - trackedRacketAngle;
    while (correction > 180.0f) correction -= 360.0f;
    while (correction < -180.0f) correction += 360.0f;
    trackedRacketAngle += 0.02f * correction;
  }

  while (trackedRacketAngle > 180.0f) trackedRacketAngle -= 360.0f;
  while (trackedRacketAngle < -180.0f) trackedRacketAngle += 360.0f;
  return trackedRacketAngle;
}

void startAdv(void) {
  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(tennisService);
  Bluefruit.Advertising.addName();
  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(160, 160);
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);
}

void setup() {
  Serial.begin(115200);
  myIMU.begin();
  
  Bluefruit.begin();
  Bluefruit.setTxPower(4);
  Bluefruit.setName("TennisSync");

  tennisService.begin();
  
  impactCharacteristic.setProperties(CHR_PROPS_READ | CHR_PROPS_NOTIFY);
  impactCharacteristic.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  impactCharacteristic.setFixedLen(14); // peakG(4) + maxGyro(4) + duration(2) + racketAngle(4)
  impactCharacteristic.begin();

  startAdv();
}

void loop() {
  float ax = myIMU.readFloatAccelX();
  float ay = myIMU.readFloatAccelY();
  float az = myIMU.readFloatAccelZ();
  float gx = myIMU.readFloatGyroX();
  float gz = myIMU.readFloatGyroZ();

  float totalG = sqrt(ax * ax + ay * ay + az * az);
  float currentRacketAngle = updateRacketAngle(ax, ay, az, gx);

  if (totalG > IMPACT_THRESHOLD) {
    float peakG = totalG;
    float maxGyro = abs(gz);
    float racketAngle = currentRacketAngle;
    unsigned long startTime = millis();
    unsigned long windowStart = millis(); 
    
    // 擷取 30ms 內的擊球最高峰值
    while (millis() - windowStart < 30) {
      float sa = myIMU.readFloatAccelX();
      float sb = myIMU.readFloatAccelY();
      float sc = myIMU.readFloatAccelZ();
      float sx = myIMU.readFloatGyroX();
      float sg = myIMU.readFloatGyroZ();
      float sampleRacketAngle = updateRacketAngle(sa, sb, sc, sx);
      
      float curG = sqrt(sa * sa + sb * sb + sc * sc);
      if (curG > peakG) {
        peakG = curG;
        racketAngle = sampleRacketAngle;
      }
      if (abs(sg) > maxGyro) maxGyro = abs(sg);
    }
    
    unsigned long duration = millis() - startTime;

    Serial.print("[SWING DETECTED] Peak G: ");
    Serial.print(peakG);
    Serial.print(" G | Max Gyro: ");
    Serial.print(maxGyro);
    Serial.print(" °/s | Duration: ");
    Serial.print(duration);
    Serial.print(" ms | Racket Angle: ");
    Serial.print(racketAngle);
    Serial.println("°");

    // 只要藍牙保持連線就強制發送，避開 notifyEnabled() 狀態判定盲點
    if (Bluefruit.connected()) {
      uint8_t payload[14];
      uint16_t durationMs = static_cast<uint16_t>(duration);
      
      // 使用 memcpy 確保 14 bytes 封包精確填入
      memcpy(&payload[0], &peakG, 4);       // 0-3 bytes: peakG
      memcpy(&payload[4], &maxGyro, 4);     // 4-7 bytes: maxGyro
      memcpy(&payload[8], &durationMs, 2);  // 8-9 bytes: duration
      memcpy(&payload[10], &racketAngle, 4); // 10-13 bytes: racketAngle
      
      uint16_t result = impactCharacteristic.notify(payload, sizeof(payload));
      
      Serial.print("BLE Notify Result (0=Success): ");
      Serial.println(result);
    }
    
    delay(400); 
  }

  delay(15);
}