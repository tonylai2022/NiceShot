const BASELINE_HITS = 5;
const MAX_HISTORY = 30;

function clamp(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, value));
}

function percentile(sortedValues, fraction) {
    if (sortedValues.length === 0) return 0;
    const index = (sortedValues.length - 1) * fraction;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export class ContactQualityTracker {
    constructor() {
        this.penalties = [];
    }

    reset() {
        this.penalties = [];
    }

    evaluate({ peakG, maxGyro, torsionKick, vibrationLevel, decayMs }) {
        const hasFeatures = [torsionKick, vibrationLevel, decayMs].every(Number.isFinite);
        if (!hasFeatures) {
            return {
                available: false,
                label: "Update firmware",
                score: null,
                confidence: 0,
                baselineProgress: 0,
                saturated: false
            };
        }

        const torsionPenalty = clamp(torsionKick / Math.max(maxGyro, 120));
        const vibrationPenalty = clamp(vibrationLevel / Math.max(peakG * 0.12, 0.5));
        const decayPenalty = clamp(decayMs / 120);
        const penalty = 0.45 * torsionPenalty + 0.35 * vibrationPenalty + 0.20 * decayPenalty;

        this.penalties.push(penalty);
        if (this.penalties.length > MAX_HISTORY) this.penalties.shift();

        const sortedPenalties = [...this.penalties].sort((left, right) => left - right);
        const baselineProgress = Math.min(this.penalties.length / BASELINE_HITS, 1);
        let score;

        if (this.penalties.length < BASELINE_HITS) {
            score = 100 * (1 - penalty);
        } else {
            const bestTypical = percentile(sortedPenalties, 0.2);
            const worstTypical = percentile(sortedPenalties, 0.8);
            const range = Math.max(worstTypical - bestTypical, 0.08);
            score = 100 * (worstTypical - penalty) / range;
        }

        score = Math.round(clamp(score, 0, 100));
        const saturated = peakG >= 15.5;
        const confidence = clamp((0.35 + 0.55 * baselineProgress) * (saturated ? 0.55 : 1));

        return {
            available: true,
            label: score >= 75 ? "Centered" : score >= 50 ? "Near Center" : "Off Center",
            score,
            confidence,
            baselineProgress,
            saturated,
            features: {
                torsionPenalty,
                vibrationPenalty,
                decayPenalty
            }
        };
    }
}
