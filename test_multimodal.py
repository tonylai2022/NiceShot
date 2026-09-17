import sys
sys.coinit_flags = 0 

import asyncio
import struct
import cv2
from bleak import BleakClient

# ==================== 配置区域 ====================
TARGET_ADDRESS = "C7:B4:0F:98:90:FD" 
CHARACTERISTIC_UUID = "19B10011-E8F2-537E-4F6C-D104768A1214"
# ==================================================

latest_peak_g = 0.0
latest_timestamp = 0
last_hit_display_timer = 0
current_stroke_type = "Ready / Waiting"
hit_history = []

def notification_handler(sender, data, mp_pose, landmarks_ref):
    global latest_peak_g, latest_timestamp, last_hit_display_timer, current_stroke_type, hit_history
    
    if len(data) >= 6:
        g_raw, time_ms = struct.unpack('<HI', data[0:6])
        latest_peak_g = g_raw / 100.0
        latest_timestamp = time_ms
        last_hit_display_timer = 45 
        
        current_frame_landmarks = landmarks_ref[0]
        if current_frame_landmarks:
            try:
                right_wrist = current_frame_landmarks[mp_pose.PoseLandmark.RIGHT_WRIST.value]
                right_shoulder = current_frame_landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value]
                pose_type = "Forehand (正手)" if right_wrist.x < right_shoulder.x else "Backhand (反手)"
            except Exception:
                pose_type = "Standard Stroke"

            if latest_peak_g > 5.0:
                current_stroke_type = f"Heavy {pose_type} (重击)"
            else:
                current_stroke_type = pose_type
        else:
            current_stroke_type = "Impact Detected"
            
        hit_record = {
            "time_ms": time_ms,
            "peak_g": latest_peak_g,
            "type": current_stroke_type
        }
        hit_history.append(hit_record)
        print(f"[MULTIMODAL HIT] Type: {current_stroke_type} | Peak G: {latest_peak_g:.2f} G | Time: {time_ms}ms")

async def run_visual_test():
    global last_hit_display_timer, current_stroke_type
    
    print(f"Connecting directly to {TARGET_ADDRESS}...")

    # 1. 优先建立蓝牙连接（此时绝对不加载 MediaPipe，避免线程冲突）
    async with BleakClient(TARGET_ADDRESS) as client:
        print(f"[+] Connected successfully! Now loading MediaPipe & Webcam...")
        
        # 2. 连接成功后再安全导入并初始化 MediaPipe
        import mediapipe as mp
        mp_pose = mp.solutions.pose
        mp_drawing = mp.solutions.drawing_utils
        pose = mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5)

        latest_landmarks = [None]
        def bound_notification_handler(sender, data):
            notification_handler(sender, data, mp_pose, latest_landmarks)

        await client.start_notify(CHARACTERISTIC_UUID, bound_notification_handler)
        
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            print("[-] Error: Could not open laptop webcam.")
            return

        print("\n[INFO] Multimodal AI Test Started! Swing or tap. Press 'q' to exit.\n")

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1)
            image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = pose.process(image_rgb)

            if results.pose_landmarks:
                latest_landmarks[0] = results.pose_landmarks.landmark
                mp_drawing.draw_landmarks(
                    frame, results.pose_landmarks, mp_pose.POSE_CONNECTIONS,
                    mp_drawing.DrawingSpec(color=(0, 255, 0), thickness=2, circle_radius=2),
                    mp_drawing.DrawingSpec(color=(0, 0, 255), thickness=2, circle_radius=2)
                )
            else:
                latest_landmarks[0] = None

            cv2.rectangle(frame, (20, 20), (520, 160), (0, 0, 0), -1)
            cv2.rectangle(frame, (20, 20), (520, 160), (0, 255, 0), 2)

            status_color = (0, 255, 0)
            if last_hit_display_timer > 0:
                status_color = (0, 0, 255)
                last_hit_display_timer -= 1
                text_status = f"DETECTED: {current_stroke_type}"
            else:
                text_status = "Ready / Tracking Pose..."

            cv2.putText(frame, "Tennis AI Vision + IMU HUD", (35, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            cv2.putText(frame, text_status, (35, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.6, status_color, 2)
            cv2.putText(frame, f"Total Strokes: {len(hit_history)}", (35, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
            cv2.putText(frame, f"Peak G: {latest_peak_g:.2f} G", (35, 145), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1)

            cv2.imshow("Tennis Multimodal AI Test (Press 'q' to quit)", frame)

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

            await asyncio.sleep(0.01)

        cap.release()
        cv2.destroyAllWindows()
        await client.stop_notify(CHARACTERISTIC_UUID)

if __name__ == "__main__":
    try:
        asyncio.run(run_visual_test())
    except KeyboardInterrupt:
        pass
    
    print("\n" + "="*45)
    print("      MULTIMODAL SESSION ANALYTICS SUMMARY      ")
    print("="*45)
    print(f"Total Strokes: {len(hit_history)}")
    for i, hit in enumerate(hit_history, 1):
        print(f"  {i}. [{hit['time_ms']}ms] {hit['type']} (Peak: {hit['peak_g']:.2f}G)")
    print("="*45)