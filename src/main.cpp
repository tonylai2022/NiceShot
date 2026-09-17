#include <Arduino.h>
#include <bluefruit.h>
#include <LSM6DS3.h>

LSM6DS3 myIMU(I2C_MODE, 0x6A);

BLEService        tennisService("19B10010-E8F2-537E-4F6C-D104768A1214");
BLECharacteristic impactCharacteristic("19B10011-E8F2-537E-4F6C-D104768A1214");

const float IMPACT_THRESHOLD = 3.5; 

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
  impactCharacteristic.setFixedLen(6); 
  impactCharacteristic.begin();

  startAdv();
}

void loop() {
  float ax = myIMU.readFloatAccelX();
  float ay = myIMU.readFloatAccelY();
  float az = myIMU.readFloatAccelZ();
  float gz = myIMU.readFloatGyroZ();

  float totalG = sqrt(ax * ax + ay * ay + az * az);

  // 串口绘图输出
  Serial.print("TotalG:");
  Serial.print(totalG);
  Serial.print(",");
  Serial.print("GyroZ:");
  Serial.println(gz / 100.0);

  if (totalG > IMPACT_THRESHOLD) {
    float peakG = totalG;
    unsigned long hitTimestamp = millis(); 
    
    unsigned long startMillis = millis();
    while (millis() - startMillis < 30) {
      float sa = myIMU.readFloatAccelX();
      float sb = myIMU.readFloatAccelY();
      float sc = myIMU.readFloatAccelZ();
      float curG = sqrt(sa * sa + sb * sb + sc * sc);
      if (curG > peakG) {
        peakG = curG;
      }
    }

    if (Bluefruit.connected() && impactCharacteristic.notifyEnabled()) {
      struct __attribute__((packed)) {
        uint16_t gVal;     
        uint32_t timeMs;   
      } payload;

      payload.gVal = (uint16_t)(peakG * 100);
      payload.timeMs = hitTimestamp;
      
      impactCharacteristic.notify((uint8_t*)&payload, sizeof(payload));
    }
    
    delay(400); 
  }

  delay(15);
}