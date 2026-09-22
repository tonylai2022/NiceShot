import { TennisBLEService } from './ble-service.js?v=2';
import { classifySwing } from './jev-service.js?v=1';
import { ContactQualityTracker } from './contact-quality.js?v=1';

const SERVICE_UUID = "19b10000-e8f2-537e-4f6c-d104768a1214";
const RACKET_HEAD_RADIUS_METERS = 0.68;

let hitHistory = [];
let latestLandmarks = null;
let previousWristX = 0;
let latestWristVelocityX = 0;
let latestImpactId = 0;
const contactQualityTracker = new ContactQualityTracker();

// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const bleStatus = document.getElementById('bleStatus');
const strokeText = document.getElementById('strokeText');
const jevInsightText = document.getElementById('jevInsightText');
const peakGText = document.getElementById('peakGText');
const maxGyroText = document.getElementById('maxGyroText');
const racketSpeedText = document.getElementById('racketSpeedText');
const racketAngleText = document.getElementById('racketAngleText');
const racketFaceLabel = document.getElementById('racketFaceLabel');
const racketFaceState = document.getElementById('racketFaceState');
const racketAngleMarker = document.getElementById('racketAngleMarker');
const faceAdviceText = document.getElementById('faceAdviceText');
const contactQualityText = document.getElementById('contactQualityText');
const contactQualityMeta = document.getElementById('contactQualityMeta');
const contactQualityBar = document.getElementById('contactQualityBar');
const contactQualityDetail = document.getElementById('contactQualityDetail');
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

function renderFaceAngle(faceAngle, strokeSide = null, waiting = false, confidence = null) {
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
    racketAngleMarker.style.backgroundColor = confidence === null
        ? "#f8fafc"
        : confidence > 0.8 ? "#34d399" : confidence >= 0.5 ? "#fbbf24" : "#94a3b8";
}

function renderContactQuality(contactQuality, rawFeatures = null) {
    if (!contactQuality?.available) {
        contactQualityText.textContent = "Unavailable";
        contactQualityText.className = "font-bold text-slate-400";
        contactQualityMeta.textContent = "Update sensor firmware";
        contactQualityBar.style.width = "0%";
        contactQualityDetail.textContent = "Requires the 20-byte contact packet";
        return;
    }

    const qualityColors = {
        Centered: ["text-emerald-300", "#34d399"],
        "Near Center": ["text-amber-300", "#fbbf24"],
        "Off Center": ["text-rose-300", "#fb7185"]
    };
    const [textClass, barColor] = qualityColors[contactQuality.label];
    const learnedHits = Math.round(contactQuality.baselineProgress * 5);

    contactQualityText.textContent = contactQuality.label;
    contactQualityText.className = `font-bold ${textClass}`;
    contactQualityMeta.textContent = contactQuality.baselineProgress < 1
        ? `${contactQuality.score}/100 · Learning ${learnedHits}/5`
        : `${contactQuality.score}/100 · ${(contactQuality.confidence * 100).toFixed(0)}% confidence`;
    contactQualityBar.style.width = `${contactQuality.score}%`;
    contactQualityBar.style.backgroundColor = barColor;
    contactQualityDetail.textContent = contactQuality.saturated
        ? "Low confidence: accelerometer clipped"
        : `Twist ${rawFeatures.torsionKick.toFixed(0)}°/s · Vibration ${rawFeatures.vibrationLevel.toFixed(2)}G · Decay ${rawFeatures.decayMs}ms`;
}

function processImpactFallback(impactData) {
    const peakG = (impactData && typeof impactData.peakG === 'number') ? impactData.peakG : 0;
    const maxGyro = (impactData && typeof impactData.maxGyro === 'number') ? impactData.maxGyro : 0;
    const measuredRacketSpeed = (impactData && Number.isFinite(impactData.racketSpeed)) ? impactData.racketSpeed : null;
    const racketSpeed = measuredRacketSpeed !== null && measuredRacketSpeed > 0
        ? measuredRacketSpeed
        : maxGyro * Math.PI / 180 * RACKET_HEAD_RADIUS_METERS * 3.6;
    const sensorAngle = (impactData && Number.isFinite(impactData.racketAngle))
        ? normalizeAngle(impactData.racketAngle)
        : null;
    const torsionKick = Number.isFinite(impactData?.torsionKick) ? impactData.torsionKick : null;
    const vibrationLevel = Number.isFinite(impactData?.vibrationLevel) ? impactData.vibrationLevel : null;
    const decayMs = Number.isFinite(impactData?.decayMs) ? impactData.decayMs : null;

    let strokeType = "Standard Stroke";
    let strokeSide = null;
    let wristX = null;
    let torsoCenterX = null;
    const isLefty = handednessSelect.value === 'left';

    if (latestLandmarks) {
        const activeWristIndex = isLefty ? 15 : 16;
        const activeWrist = latestLandmarks[activeWristIndex];

        const leftShoulder = latestLandmarks[11];
        const rightShoulder = latestLandmarks[12];
        torsoCenterX = (leftShoulder.x + rightShoulder.x) / 2;
        wristX = activeWrist.x;

        const wristVelocityX = latestWristVelocityX;

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

    return {
        peakG,
        maxGyro,
        racketSpeed,
        torsionKick,
        vibrationLevel,
        decayMs,
        sensorAngle,
        wristX,
        torsoCenterX,
        wristVelocityX: latestWristVelocityX,
        isLefty,
        faceAngle,
        faceState,
        strokeSide,
        strokeType
    };
}

const strokeLabels = {
    forehand_topspin: "Forehand Topspin",
    forehand_slice: "Forehand Slice",
    backhand_drive: "Backhand Drive",
    backhand_slice: "Backhand Slice",
    serve: "Serve",
    smash: "Smash"
};

const faceAdviceLabels = {
    too_open_slice: "Face too open: reduce slice",
    too_closed_topspin: "Face too closed: reduce topspin",
    perfect_neutral: "Face angle is neutral",
    close_3deg_for_spin: "Close face 3° for more spin"
};

function updateStrokeText(strokeType, uncertain = false) {
    const style = getStrokeStyle(strokeType);
    strokeText.textContent = `${strokeType}${uncertain ? " ?" : ""}`;
    strokeText.className = `text-lg font-bold ${style.text} mt-1`;
    return style;
}

function commitImpact(record) {
    hitHistory.push(record);
    totalHitsText.textContent = hitHistory.length;
    record.logElement = appendLog(record, updateStrokeText(record.type, record.uncertain));
}

function updateImpactClassification(record) {
    if (record.logElement) {
        const typeElement = record.logElement.querySelector("[data-stroke-type]");
        if (typeElement) {
            const style = getStrokeStyle(record.type);
            typeElement.textContent = `${record.type}${record.uncertain ? " ?" : ""}`;
            typeElement.className = `${style.text} font-bold`;
        }
    }
}

function processImpact(impactData) {
    const fallback = processImpactFallback(impactData);
    const impactId = ++latestImpactId;
    const contactQuality = contactQualityTracker.evaluate(fallback);

    peakGText.textContent = `${fallback.peakG.toFixed(2)} G`;
    maxGyroText.textContent = `${fallback.maxGyro.toFixed(1)} °/s`;
    racketSpeedText.textContent = `${fallback.racketSpeed.toFixed(1)} km/h`;
    renderFaceAngle(fallback.faceAngle, fallback.strokeSide);
    renderContactQuality(contactQuality, fallback);
    faceAdviceText.textContent = navigator.onLine === false ? "Offline analysis" : "Analyzing swing...";
    jevInsightText.textContent = navigator.onLine === false ? "Local classifier" : "JEV analyzing...";
    updateStrokeText(fallback.strokeType, navigator.onLine !== false);

    const record = {
        timeMs: Date.now(),
        peakG: fallback.peakG,
        maxGyro: fallback.maxGyro,
        racketSpeed: fallback.racketSpeed,
        faceAngle: fallback.faceAngle,
        faceState: fallback.faceState,
        contactQuality,
        type: fallback.strokeType,
        uncertain: false
    };

    // The IMU impact threshold owns hit detection. JEV only refines classification.
    commitImpact(record);

    if (navigator.onLine === false) {
        return;
    }

    const state = {
        peakG: fallback.peakG,
        maxGyro: fallback.maxGyro,
        racketSpeed: fallback.racketSpeed,
        sensorAngle: fallback.sensorAngle === null ? null : Math.abs(fallback.sensorAngle),
        strokeSide: fallback.strokeSide,
        wristX: fallback.wristX,
        torsoCenterX: fallback.torsoCenterX,
        wristVelocityX: fallback.wristVelocityX,
        isLefty: fallback.isLefty,
        faceAngle: fallback.faceAngle === null ? null : Math.abs(fallback.faceAngle),
        contactQuality: contactQuality.available ? {
            label: contactQuality.label,
            score: contactQuality.score,
            confidence: contactQuality.confidence,
            torsionKick: fallback.torsionKick,
            vibrationLevel: fallback.vibrationLevel,
            decayMs: fallback.decayMs
        } : null,
        hitHistoryTail: hitHistory.slice(-5).map(({ peakG, maxGyro, racketSpeed, faceAngle, type }) => ({
            peakG,
            maxGyro,
            racketSpeed,
            faceAngle,
            type
        }))
    };

    classifySwing(state).then((result) => {
        const { answers } = result;
        const strokeAnswer = answers.stroke_type;
        const jevStrokeSide = strokeAnswer.choice.startsWith("backhand") ? "Backhand"
            : strokeAnswer.choice.startsWith("forehand") ? "Forehand"
                : null;
        const sideMatchesCamera = fallback.strokeSide === null || jevStrokeSide === null || jevStrokeSide === fallback.strokeSide;

        if (strokeAnswer.confidence >= 0.5 && sideMatchesCamera) {
            record.type = strokeLabels[strokeAnswer.choice] || fallback.strokeType;
            record.uncertain = strokeAnswer.confidence <= 0.8;
        }
        record.jev = {
            confidence: strokeAnswer.confidence,
            quality: answers.quality,
            latency: result.latency,
            input_tokens: result.input_tokens
        };

        updateImpactClassification(record);
        if (impactId === latestImpactId) {
            updateStrokeText(record.type, record.uncertain);
            const adviceConfidence = answers.face_advice.confidence;
            faceAdviceText.textContent = adviceConfidence < 0.5
                ? "Face advice uncertain"
                : `${faceAdviceLabels[answers.face_advice.choice] || "Swing analyzed"}${adviceConfidence <= 0.8 ? " ?" : ""}`;
            jevInsightText.textContent = `JEV ${answers.quality.label} · ${(strokeAnswer.confidence * 100).toFixed(0)}% · ${result.latency} ms`;
            renderFaceAngle(fallback.faceAngle, fallback.strokeSide, false, answers.face_advice.confidence);
        }
    }).catch(() => {
        if (impactId === latestImpactId) {
            faceAdviceText.textContent = "Offline fallback used";
            jevInsightText.textContent = "Local classifier";
            renderFaceAngle(fallback.faceAngle, fallback.strokeSide);
        }
    });
}

function appendLog(record, style) {
    if (hitHistory.length === 1) logContainer.innerHTML = "";
    const logItem = document.createElement('div');
    logItem.className = `p-2.5 bg-slate-950 border ${style.bg} rounded-lg flex justify-between items-center text-xs`;
    logItem.innerHTML = `
        <span data-stroke-type class="${style.text} font-bold">${record.type}</span>
        <div class="flex gap-3 font-mono text-slate-300">
            <span>${record.peakG.toFixed(2)}G</span>
            <span>${record.maxGyro.toFixed(0)}°/s</span>
            <span>${record.racketSpeed === null ? "N/A" : `${record.racketSpeed.toFixed(1)}km/h`}</span>
            <span>${record.contactQuality.available ? `${record.contactQuality.label} ${record.contactQuality.score}` : "Contact N/A"}</span>
            <span>${record.faceAngle === null ? record.faceState : `${record.faceState} ${record.faceAngle >= 0 ? "+" : ""}${record.faceAngle.toFixed(1)}°`}</span>
        </div>
    `;
    logContainer.prepend(logItem);
    return logItem;
}

clearLogBtn.addEventListener('click', () => {
    hitHistory = [];
    contactQualityTracker.reset();
    logContainer.innerHTML = `<div class="text-slate-500 italic">No impacts recorded yet. Swing racket...</div>`;
    totalHitsText.textContent = "0";
    peakGText.textContent = "0.00 G";
    if (maxGyroText) maxGyroText.textContent = "0.00 °/s";
    if (racketSpeedText) racketSpeedText.textContent = "0.0 km/h";
    renderFaceAngle(null, null, true);
    faceAdviceText.textContent = "Waiting for a swing";
    jevInsightText.textContent = "JEV ready";
    renderContactQuality(null);
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
        const currentWristX = latestLandmarks[activeWristIndex].x;

        latestWristVelocityX = previousWristX === 0 ? 0 : currentWristX - previousWristX;
        previousWristX = currentWristX;

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