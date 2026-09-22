import { TennisBLEService } from './ble-service.js?v=2';

const SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214";
const RACKET_HEAD_RADIUS_METERS = 0.68;

let hitHistory = [];
let latestLandmarks = null;
let previousWristX = 0;

// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const bleStatus = document.getElementById('bleStatus');
const strokeText = document.getElementById('strokeText');
const peakGText = document.getElementById('peakGText');
const maxGyroText = document.getElementById('maxGyroText');
const racketSpeedText = document.getElementById('racketSpeedText');
const racketAngleText = document.getElementById('racketAngleText');
const racketFaceLabel = document.getElementById('racketFaceLabel');
const racketFaceState = document.getElementById('racketFaceState');
const racketAngleMarker = document.getElementById('racketAngleMarker');
const totalHitsText = document.getElementById('totalHitsText');
const logContainer = document.getElementById('logContainer');
const clearLogBtn = document.getElementById('clearLogBtn');
const handednessSelect = document.getElementById('handednessSelect');

const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('outputCanvas');
const canvasCtx = canvasElement.getContext('2d');

const bleService = new TennisBLEService(
    SERVICE_UUID,
    (impactData) => processImpact(impactData),
    (isConnected, deviceName) => updateConnectionUI(isConnected, deviceName)
);

connectBtn.addEventListener('click', async () => {
    bleStatus.textContent = "Status: Scanning...";
    bleStatus.className = "flex items-center px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-blue-400";
    try {
        await bleService.connect();
    } catch (e) {
        bleStatus.textContent = "Status: Connection Failed";
        bleStatus.className = "flex items-center px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-red-400";
    }
});

function updateConnectionUI(isConnected, name) {
    if (isConnected) {
        bleStatus.textContent = `Status: Connected (${name})`;
        bleStatus.className = "flex items-center px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-emerald-400";
        connectBtn.textContent = "Connected";
        connectBtn.classList.replace('bg-emerald-600', 'bg-slate-800');
        connectBtn.disabled = true;
    } else {
        bleStatus.textContent = "Status: Disconnected";
        bleStatus.className = "flex items-center px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-sm text-amber-400";
        connectBtn.textContent = "Connect Sensor (BLE)";
        connectBtn.classList.replace('bg-slate-800', 'bg-emerald-600');
        connectBtn.disabled = false;
    }
}

// 根據不同揮拍類型指定專屬 Tailwind 顏色樣式
function getStrokeStyle(strokeType) {
    if (strokeType.includes("Smash") || strokeType.includes("Heavy")) {
        return { text: "text-purple-400", bg: "bg-purple-950/40 border-purple-800/60" };
    } else if (strokeType.includes("Backhand")) {
        return { text: "text-cyan-400", bg: "bg-cyan-950/40 border-cyan-800/60" };
    } else if (strokeType.includes("Slice")) {
        return { text: "text-amber-400", bg: "bg-amber-950/40 border-amber-800/60" };
    } else {
        return { text: "text-emerald-400", bg: "bg-emerald-950/40 border-emerald-800/60" };
    }
}

function normalizeAngle(angle) {
    return ((angle + 180) % 360 + 360) % 360 - 180;
}

function getFaceAngle(sensorAngle, strokeSide) {
    if (sensorAngle === null || strokeSide === null) return null;
    const forehandFaceAngle = 90 - Math.abs(normalizeAngle(sensorAngle));
    return strokeSide === "Backhand" ? -forehandFaceAngle : forehandFaceAngle;
}

function getFaceState(faceAngle) {
    if (faceAngle === null) return "Waiting";
    if (faceAngle > 5) return "Open";
    if (faceAngle < -5) return "Closed";
    return "Neutral";
}

function renderFaceAngle(faceAngle, strokeSide = null, waiting = false) {
    const faceState = waiting ? "Waiting" : strokeSide === null ? "Camera needed" : getFaceState(faceAngle);
    const stateClasses = {
        Open: "text-cyan-300",
        Neutral: "text-emerald-300",
        Closed: "text-amber-300",
        "Camera needed": "text-slate-400",
        Waiting: "text-slate-400"
    };

    racketFaceLabel.textContent = strokeSide === null ? "Racket Face" : `${strokeSide} Face`;
    racketAngleText.textContent = faceAngle === null
        ? "--"
        : `${faceAngle >= 0 ? "+" : ""}${faceAngle.toFixed(1)}°`;
    racketFaceState.textContent = faceState;
    racketFaceState.className = `text-xs font-bold uppercase ${stateClasses[faceState]}`;

    const markerPosition = faceAngle === null ? 50 : Math.max(0, Math.min(100, 50 + faceAngle / 0.9));
    racketAngleMarker.style.left = `${markerPosition}%`;
    racketAngleMarker.classList.toggle("opacity-0", faceAngle === null);
}

// 進階揮拍分類與多指標處理（含資料防呆）
function processImpact(impactData) {
    const peakG = (impactData && typeof impactData.peakG === 'number') ? impactData.peakG : 0;
    const maxGyro = (impactData && typeof impactData.maxGyro === 'number') ? impactData.maxGyro : 0;
    const measuredRacketSpeed = (impactData && Number.isFinite(impactData.racketSpeed)) ? impactData.racketSpeed : null;
    const racketSpeed = measuredRacketSpeed !== null && measuredRacketSpeed > 0
        ? measuredRacketSpeed
        : maxGyro * Math.PI / 180 * RACKET_HEAD_RADIUS_METERS * 3.6;
    const sensorAngle = (impactData && Number.isFinite(impactData.racketAngle))
        ? normalizeAngle(impactData.racketAngle)
        : null;

    let strokeType = "Standard Stroke";
    let strokeSide = null;
    const isLefty = handednessSelect.value === 'left';

    if (latestLandmarks) {
        const activeWristIndex = isLefty ? 15 : 16;
        const activeWrist = latestLandmarks[activeWristIndex];

        const leftShoulder = latestLandmarks[11];
        const rightShoulder = latestLandmarks[12];
        const torsoCenterX = (leftShoulder.x + rightShoulder.x) / 2;

        const wristVelocityX = activeWrist.x - previousWristX;

        if (!isLefty) {
            const isBackhandZone = activeWrist.x < torsoCenterX || (activeWrist.x < rightShoulder.x && wristVelocityX < 0);
            strokeSide = isBackhandZone ? "Backhand" : "Forehand";

            if (isBackhandZone) {
                strokeType = peakG > 5.5 ? "Backhand Drive" : "Backhand Slice";
            } else {
                strokeType = peakG > 6.5 ? "Forehand Smash / Heavy Drive" : "Forehand Drive";
            }
        } else {
            const isBackhandZone = activeWrist.x > torsoCenterX || (activeWrist.x > leftShoulder.x && wristVelocityX > 0);
            strokeSide = isBackhandZone ? "Backhand" : "Forehand";

            if (isBackhandZone) {
                strokeType = peakG > 5.5 ? "Backhand Drive" : "Backhand Slice";
            } else {
                strokeType = peakG > 6.5 ? "Forehand Smash / Heavy Drive" : "Forehand Drive";
            }
        }
    } else {
        strokeType = peakG > 6.0 ? "Heavy Impact" : "Standard Stroke";
    }

    const faceAngle = getFaceAngle(sensorAngle, strokeSide);
    const faceState = strokeSide === null ? "Camera needed" : getFaceState(faceAngle);

    const timestampMs = Date.now();
    const record = { timeMs: timestampMs, peakG, maxGyro, racketSpeed, faceAngle, faceState, type: strokeType };
    hitHistory.push(record);

    // 更新 HUD 顯示（安全防呆 toFixed）
    peakGText.textContent = `${peakG.toFixed(2)} G`;
    if (maxGyroText) maxGyroText.textContent = `${maxGyro.toFixed(1)} °/s`;
    if (racketSpeedText) racketSpeedText.textContent = racketSpeed === null ? "N/A" : `${racketSpeed.toFixed(1)} km/h`;
    renderFaceAngle(faceAngle, strokeSide);
    totalHitsText.textContent = hitHistory.length;

    const style = getStrokeStyle(strokeType);
    strokeText.textContent = strokeType;
    strokeText.className = `text-lg font-bold ${style.text} mt-1`;

    appendLog(record, style);
}

function appendLog(record, style) {
    if (hitHistory.length === 1) logContainer.innerHTML = "";
    const logItem = document.createElement('div');
    logItem.className = `p-2.5 bg-slate-950 border ${style.bg} rounded-lg flex justify-between items-center text-xs`;
    logItem.innerHTML = `
        <span class="${style.text} font-bold">${record.type}</span>
        <div class="flex gap-3 font-mono text-slate-300">
            <span>${record.peakG.toFixed(2)}G</span>
            <span>${record.maxGyro.toFixed(0)}°/s</span>
            <span>${record.racketSpeed === null ? "N/A" : `${record.racketSpeed.toFixed(1)}km/h`}</span>
            <span>${record.faceAngle === null ? record.faceState : `${record.faceState} ${record.faceAngle >= 0 ? "+" : ""}${record.faceAngle.toFixed(1)}°`}</span>
        </div>
    `;
    logContainer.prepend(logItem);
}

clearLogBtn.addEventListener('click', () => {
    hitHistory = [];
    logContainer.innerHTML = `<div class="text-slate-500 italic">No impacts recorded yet. Swing racket...</div>`;
    totalHitsText.textContent = "0";
    peakGText.textContent = "0.00 G";
    if (maxGyroText) maxGyroText.textContent = "0.00 °/s";
    if (racketSpeedText) racketSpeedText.textContent = "0.0 km/h";
    renderFaceAngle(null, null, true);
    strokeText.textContent = "Tracking Active";
    strokeText.className = "text-lg font-bold text-emerald-400 mt-1";
});

// --- MediaPipe Pose Integration ---
function onResults(results) {
    canvasElement.width = videoElement.videoWidth || 640;
    canvasElement.height = videoElement.videoHeight || 480;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
        latestLandmarks = results.poseLandmarks;
        const isLefty = handednessSelect.value === 'left';
        const activeWristIndex = isLefty ? 15 : 16;

        previousWristX = latestLandmarks[activeWristIndex].x;

        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#10b981', lineWidth: 2 });
        drawLandmarks(canvasCtx, results.poseLandmarks, { color: '#ef4444', lineWidth: 1, radius: 3 });
    } else {
        latestLandmarks = null;
    }
    canvasCtx.restore();
}

const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});
pose.onResults(onResults);

const camera = new Camera(videoElement, {
    onFrame: async () => {
        await pose.send({ image: videoElement });
    },
    width: 640,
    height: 480
});
camera.start();