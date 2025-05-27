// sound.js

import * as state from './state.js';
// import * as ui from './ui.js'; // Only if sound toggle button is managed here, otherwise in main/eventListeners

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

        modalOpenSound = new Tone.Synth({
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
                 // PolySynth uses triggerAttackRelease with an array of notes, or single note
                // NoiseSynth and MembraneSynth are typically just triggered
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
    } else if (!state.soundEnabled && state.soundsInitialized) {
        // Optional: play a muted click or a different sound for 'off'
        playSound(uiClickSound, "C3", "16n");
    }
    // Update UI toggle button if it exists and is managed from here
    // ui.updateSoundToggleButton(state.soundEnabled); 
    console.log(`Sound enabled: ${state.soundEnabled}`);
    return state.soundEnabled;
}

// Example of how sounds might be used by gameLogic or ui:
// playSound(lineSound, "C4", "32n");
// playSound(boxSound, "A5", "16n", Tone.now() + i * 0.1); // For multiple boxes
// playSound(winSound, ["C4", "E4", "G4", "C5"], "8n"); // Chord for win
// playSound(errorSound, undefined, "16n"); // Error sound needs no note for NoiseSynth