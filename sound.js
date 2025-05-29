// sound.js

import * as state from './state.js';
// import * as ui from './ui.js'; // Only if sound/haptics toggle button is managed here

// ---------- TONE.JS SOUND DEFINITIONS ----------
// These will be initialized in initSounds()
export let lineSound = null;
export let boxSound = null;
export let winSound = null;
export let tieSound = null; // Specific sound for ties
export let uiClickSound = null;
export let modalOpenSound = null;
export let modalCloseSound = null;
export let undoSound = null;
export let gameStartSound = null; // Sound for when a new game starts
export let errorSound = null; // Sound for invalid actions or errors

export let hapticsEnabled = true; // User preference for haptics. Can be made persistent.

/**
 * Initializes all Tone.js instruments and sets their default parameters.
 * This should be called once, ideally after a user interaction (e.g., clicking "Start Game").
 */
export async function initSounds() {
    if (state.soundsInitialized) return;

    try {
        // Ensure Tone.js context is started (required by modern browsers)
        await Tone.start();
        console.log("Tone.js AudioContext started.");

        lineSound = new Tone.Synth({
            oscillator: { type: 'sine' },
            envelope: { attack: 0.005, decay: 0.1, sustain: 0.01, release: 0.1 },
            volume: -12
        }).toDestination();

        boxSound = new Tone.Synth({
            oscillator: { type: 'triangle8' },
            envelope: { attack: 0.01, decay: 0.2, sustain: 0.05, release: 0.2 },
            portamento: 0.01,
            volume: -8
        }).toDestination();

        winSound = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'fmtriangle' }, // A brighter sound for winning
            envelope: { attack: 0.01, decay: 0.1, sustain: 0.2, release: 0.3 },
            volume: -5
        }).toDestination();

        tieSound = new Tone.PolySynth(Tone.Synth, { // Slightly different for a tie
            oscillator: { type: 'pulse', width: 0.4 },
            envelope: { attack: 0.02, decay: 0.2, sustain: 0.1, release: 0.3 },
            volume: -7
        }).toDestination();
        
        uiClickSound = new Tone.MembraneSynth({ // Good for UI clicks
            pitchDecay: 0.008,
            octaves: 2,
            oscillator: { type: 'square' },
            envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
            volume: -18
        }).toDestination();

        modalOpenSound = new Tone.Synth({ // Example sound for modal open
            oscillator: { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
            volume: -15
        }).toDestination();
        
        modalCloseSound = new Tone.MembraneSynth({
            pitchDecay: 0.01,
            octaves: 3,
            envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
            volume: -20
        }).toDestination();

        undoSound = new Tone.Synth({
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.01, decay: 0.1, sustain: 0.05, release: 0.1 },
            volume: -15
        }).toDestination();

        gameStartSound = new Tone.Synth({ // A welcoming sound
            oscillator: { type: 'triangle' },
            envelope: { attack: 0.05, decay: 0.2, sustain: 0.1, release: 0.2 },
            volume: -10
        }).toDestination();

        errorSound = new Tone.NoiseSynth({ // For errors or invalid moves
            noise: { type: 'pink' },
            envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.1 },
            volume: -15
        }).toDestination();

        state.setSoundsInitialized(true);
        console.log("Cajitas de Dani: Sounds initialized with Tone.js.");
    } catch (e) {
        console.error("Error initializing sounds with Tone.js:", e);
        state.setSoundsInitialized(false);
    }
}

/**
 * Plays a specified sound.
 * @param {Tone.Instrument} soundObject - The Tone.js instrument object (e.g., lineSound).
 * @param {string | string[] | number | number[]} [note="C4"] - The note(s) to play.
 * @param {string | number} [duration="8n"] - The duration of the note.
 * @param {number} [time=undefined] - Optional: when to schedule the sound (Tone.now() + offset).
 */
export function playSound(soundObject, note = "C4", duration = "8n", time = undefined) {
    if (state.soundEnabled && state.soundsInitialized && soundObject && Tone.context.state === 'running') {
        try {
            if (soundObject.name === "PolySynth" || soundObject.name === "NoiseSynth" || soundObject.name === "MembraneSynth") {
                if (soundObject.name === "NoiseSynth" || soundObject.name === "MembraneSynth") {
                    soundObject.triggerAttackRelease(duration, time);
                } else { // PolySynth
                    soundObject.triggerAttackRelease(note, duration, time);
                }
            } else { // Basic Synth
                 soundObject.triggerAttackRelease(note, duration, time);
            }
        } catch (e) {
            console.error("Error playing sound:", e, { soundObject, note, duration });
        }
    }
}

/**
 * Triggers haptic feedback if available and enabled.
 * @param {number | number[]} pattern - Vibration pattern (e.g., 50, [100, 30, 100]).
 * A single number is duration in ms.
 * An array is [vibrate_ms, pause_ms, vibrate_ms, ...].
 */
export function triggerVibration(pattern = 50) {
    if (hapticsEnabled && typeof navigator.vibrate === 'function') {
        try {
            navigator.vibrate(pattern);
        } catch (e) {
            // This can happen if the pattern is too long or invalid on some browsers,
            // or if document is not focused, etc.
            console.warn("Haptic feedback failed or was ignored by the browser:", e);
        }
    }
}


/**
 * Toggles the sound enabled state.
 * This function would typically be called by a UI button.
 */
export function toggleSoundEnabled() {
    state.setSoundEnabled(!state.soundEnabled);
    // Persist this setting if desired (e.g., localStorage)
    // localStorage.setItem('cajitasSoundEnabled', state.soundEnabled.toString());
    
    // Play a sound to indicate the new state (if sound is now on)
    if (state.soundEnabled && state.soundsInitialized) {
        playSound(uiClickSound, "C5", "16n");
        triggerVibration(20); // Haptic for toggle on
    } else if (!state.soundEnabled && state.soundsInitialized) {
        // Optional: play a muted click or a different sound for 'off'
        playSound(uiClickSound, "C3", "16n"); // No haptic for toggle off, or a different one
    }
    // Update UI toggle button if it exists and is managed from here
    // ui.updateSoundToggleButton(state.soundEnabled); 
    console.log(`Sound enabled: ${state.soundEnabled}`);
    return state.soundEnabled;
}

/**
 * Toggles the haptics enabled state.
 * UI for this toggle would need to be added separately.
 */
export function toggleHapticsEnabled() {
    hapticsEnabled = !hapticsEnabled;
    // Persist this setting if desired (e.g., localStorage)
    // localStorage.setItem('cajitasHapticsEnabled', hapticsEnabled.toString());
    console.log(`Haptics enabled: ${hapticsEnabled}`);
    if (hapticsEnabled && state.soundsInitialized) { // Play a small confirmation vibration if turned on
        triggerVibration(30);
        playSound(uiClickSound, "C4", "16n"); // Also play a sound for haptic toggle
    } else if (!hapticsEnabled && state.soundsInitialized) {
        playSound(uiClickSound, "G3", "16n");
    }
    // ui.updateHapticsToggleButton(hapticsEnabled); // If a UI button exists for this
    return hapticsEnabled;
}