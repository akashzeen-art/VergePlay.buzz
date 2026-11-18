import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./StoryModal.module.css";
import { fetchStoriesByCategory, pickMatchingStory } from "../api/stories";
import { useLanguage } from "../contexts/LanguageContext";

const DEFAULT_TYPING_SPEED_MS = 14;

const joinStoryText = (story) => {
  if (!story) return "";
  const title = story.title || story.name || story.heading;
  const subtitle = story.subTitle || story.subtitle || story.sub_title || story.sub || story.tagline;
  const body = story.dsc || story.desc || story.description || story.story || story.content || story.text || story.body;
  const t = title ? `${title}\n` : "";
  const s = subtitle ? `${subtitle}\n\n` : "";
  const b = body ? String(body) : "";
  return `${t}${s}${b}`.trim();
};

const speakText = (text, voice, rate, pitch) => {
  if (!window.speechSynthesis) return null;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  if (voice) utter.voice = voice;
  utter.rate = rate;
  if (typeof pitch === "number") utter.pitch = pitch;
  const keepAlive = setInterval(() => {
    if (!window.speechSynthesis.speaking) clearInterval(keepAlive);
    else { window.speechSynthesis.pause(); window.speechSynthesis.resume(); }
  }, 10000);
  utter.onend = () => clearInterval(keepAlive);
  utter.onerror = () => clearInterval(keepAlive);
  setTimeout(() => window.speechSynthesis.speak(utter), 100);
  return utter;
};

const stopSpeaking = () => window.speechSynthesis?.cancel();

const useSpeechVoices = () => {
  const [voices, setVoices] = useState([]);
  const [supported] = useState(() => typeof window !== "undefined" && !!window.speechSynthesis);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    let tries = 0;
    const poll = () => {
      const v = synth.getVoices();
      if (v?.length) setVoices(v);
      else if (tries++ < 25) setTimeout(poll, 120);
    };
    poll();
    synth.onvoiceschanged = () => setVoices(synth.getVoices());
    return () => { try { synth.onvoiceschanged = null; } catch (_) {} };
  }, []);
  const refreshVoices = () => {
    try { setVoices(window.speechSynthesis?.getVoices() || []); } catch (_) {}
  };
  return { voices, refreshVoices, supported };
};

const GENRE_ICONS = {
  action: "⚔️", fantasy: "🧙", scifi: "🚀", horror: "👻",
  mystery: "🔍", drama: "🎭", romantic: "💕", fairytale: "🧚",
};

const GEN_MESSAGES = [
  "Crafting your story…",
  "Building characters…",
  "Setting the scene…",
  "Adding the magic…",
  "Almost ready…",
];

const StoryModal = ({ isOpen, onClose, category, preferredTitle, rawText }) => {
  const { language } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);
  const [genPhase, setGenPhase] = useState(0);
  const [stories, setStories] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [typedText, setTypedText] = useState("");
  const [isTyping, setIsTyping] = useState(true);
  const [typingSpeed, setTypingSpeed] = useState(DEFAULT_TYPING_SPEED_MS);
  const [speakEnabled, setSpeakEnabled] = useState(false);
  const [speechRate, setSpeechRate] = useState(() => Number(localStorage.getItem("story_voice_rate")) || 1);
  const [speechPitch, setSpeechPitch] = useState(() => Number(localStorage.getItem("story_voice_pitch")) || 1);
  const [selectedVoiceName, setSelectedVoiceName] = useState(() => localStorage.getItem("story_voice_name") || "");
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [generatedStories, setGeneratedStories] = useState([]);
  const { voices, refreshVoices, supported } = useSpeechVoices();

  const filteredVoices = useMemo(() =>
    voices.filter(v => {
      const l = v.lang.toLowerCase();
      return l.startsWith("en") || l.startsWith("fr") || l.startsWith("es") || l.startsWith("ar");
    }), [voices]);

  const langMap = { EN: "en", FR: "fr", ES: "es", AR: "ar" };

  const preferredVoice = useMemo(() => {
    const lc = langMap[language] || "en";
    if (selectedVoiceName) {
      const v = filteredVoices.find(v => v.name === selectedVoiceName);
      if (v) return v;
    }
    return filteredVoices.find(v => v.lang.toLowerCase().startsWith(lc)) || filteredVoices[0];
  }, [filteredVoices, selectedVoiceName, language]);

  const presets = useMemo(() => ([
    { id: "male",   label: "👨 Male",   test: /(Guy|Male|David|Mark|George|Brian|Eric|Matthew)/i },
    { id: "female", label: "👩 Female", test: /(Female|Zira|Jenny|Samantha|Aria|Lia|Olivia|Emma)/i },
  ]), []);

  const applyPreset = (id) => {
    const p = presets.find(p => p.id === id);
    const match = filteredVoices.find(v => p?.test.test(`${v.name} ${v.lang}`));
    if (match) setSelectedVoiceName(match.name);
  };

  const typingTimerRef = useRef(null);
  const genTimerRef = useRef(null);

  const activeStory = generatedStories[activeIndex] || stories[activeIndex] ||
    (rawText ? { title: preferredTitle || "Story", dsc: rawText } : null);

  const fullText = useMemo(() => {
    if (generatedStories[activeIndex]) return generatedStories[activeIndex].dsc;
    return rawText ? String(rawText) : joinStoryText(activeStory);
  }, [activeStory, rawText, generatedStories, activeIndex]);

  // Cycle through generating messages
  useEffect(() => {
    if (!isLoading) { setGenPhase(0); return; }
    genTimerRef.current = setInterval(() =>
      setGenPhase(p => (p + 1) % GEN_MESSAGES.length), 900);
    return () => clearInterval(genTimerRef.current);
  }, [isLoading]);

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    setIsLoading(true);
    setTypedText("");
    setIsTyping(true);
    stopSpeaking();
    if (rawText) {
      setStories([]);
      setActiveIndex(0);
      setGeneratedStories([{ title: preferredTitle || "Story", dsc: rawText }]);
      setTimeout(() => mounted && setIsLoading(false), 1800);
      setOriginalPrompt(preferredTitle || "");
      return;
    }
    setGeneratedStories([]);
    fetchStoriesByCategory(category)
      .then((list) => {
        if (!mounted) return;
        const normalize = (s) => ({
          ...s,
          title: s?.title || s?.name || s?.heading || "",
          subTitle: s?.subTitle || s?.subtitle || s?.sub_title || s?.tagline || "",
          dsc: s?.dsc || s?.desc || s?.description || s?.story || s?.content || s?.text || s?.body || "",
        });
        const ordered = Array.isArray(list) ? list.map(normalize) : [];
        const first = pickMatchingStory(ordered, preferredTitle);
        const startIndex = Math.max(0, first ? ordered.findIndex(s => s === first) : 0);
        setStories(ordered);
        setActiveIndex(startIndex >= 0 ? startIndex : 0);
      })
      .finally(() => {
        if (!mounted) return;
        // Keep generating overlay for at least 1.8s for UX
        setTimeout(() => mounted && setIsLoading(false), 1800);
      });
    return () => { mounted = false; };
  }, [isOpen, category, preferredTitle, rawText]);

  useEffect(() => {
    if (!isOpen) return;
    setTypedText("");
    setIsTyping(true);
    stopSpeaking();
  }, [fullText, isOpen]);

  useEffect(() => {
    if (!isOpen || !isTyping || !fullText) return;
    if (typedText.length >= fullText.length) { setIsTyping(false); return; }
    const t = setTimeout(() =>
      setTypedText(prev => prev + fullText[prev.length]), typingSpeed);
    typingTimerRef.current = t;
    return () => clearTimeout(t);
  }, [typedText, isTyping, typingSpeed, fullText, isOpen]);

  const handleClose = () => {
    clearTimeout(typingTimerRef.current);
    stopSpeaking();
    onClose?.();
  };

  const handleTogglePlay = () => {
    if (isTyping) { setIsTyping(false); clearTimeout(typingTimerRef.current); }
    else setIsTyping(true);
  };

  const handleRestart = () => {
    clearTimeout(typingTimerRef.current);
    stopSpeaking();
    setTypedText("");
    setIsTyping(true);
  };

  const handleSpeakToggle = () => {
    const next = !speakEnabled;
    setSpeakEnabled(next);
    if (!next) { stopSpeaking(); return; }
    stopSpeaking();
    setTimeout(() => {
      speakText(fullText, preferredVoice, speechRate, speechPitch);
    }, 150);
  };

  const handleNext = async () => {
    if (!originalPrompt && stories.length <= 1) return;
    if (originalPrompt) {
      setIsLoading(true);
      stopSpeaking();
      try {
        const { sendStoryPrompt } = await import("../api/stories");
        const lc = langMap[language] || "en";
        const newStory = await sendStoryPrompt(originalPrompt, lc);
        if (newStory) {
          const obj = { title: originalPrompt, dsc: newStory };
          setGeneratedStories(prev => {
            const updated = [...prev, obj];
            setActiveIndex(updated.length - 1);
            return updated;
          });
        }
      } catch (e) { console.error(e); }
      finally { setTimeout(() => setIsLoading(false), 1800); }
    } else {
      setActiveIndex((activeIndex + 1) % stories.length);
    }
  };

  useEffect(() => {
    if (!isOpen || !speakEnabled || !fullText) return;
    stopSpeaking();
    speakText(fullText, preferredVoice, speechRate, speechPitch);
    return () => stopSpeaking();
  }, [activeIndex, speakEnabled, speechRate, speechPitch, preferredVoice, fullText, isOpen]);

  useEffect(() => { localStorage.setItem("story_voice_rate", String(speechRate)); }, [speechRate]);
  useEffect(() => { localStorage.setItem("story_voice_pitch", String(speechPitch)); }, [speechPitch]);
  useEffect(() => { if (selectedVoiceName) localStorage.setItem("story_voice_name", selectedVoiceName); }, [selectedVoiceName]);

  if (!isOpen) return null;

  const catKey = String(category || "").toLowerCase();
  const genIcon = GENRE_ICONS[catKey] || "✨";
  const progress = fullText ? Math.min(100, (typedText.length / fullText.length) * 100) : 0;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>

        {/* ── Generating overlay ── */}
        {isLoading && (
          <div className={styles.generatingOverlay}>
            <div className={styles.genIcon}>{genIcon}</div>
            <div className={styles.genTitle}>{GEN_MESSAGES[genPhase]}</div>
            <div className={styles.genDots}>
              <div className={styles.genDot} />
              <div className={styles.genDot} />
              <div className={styles.genDot} />
            </div>
            <div className={styles.genBar}>
              <div className={styles.genBarFill} />
            </div>
            <div className={styles.genSubtext}>Preparing your {catKey || "story"} experience</div>
          </div>
        )}

        {/* ── Header ── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.categoryPill}>
              {genIcon} {String(category || "Story").toUpperCase()}
            </div>
            <h3 className={styles.titleText}>{activeStory?.title || "Story"}</h3>
            {activeStory?.subTitle && (
              <p className={styles.subtitleText}>{activeStory.subTitle}</p>
            )}
          </div>
          <div className={styles.headerRight}>
            <button
              className={`${styles.voiceToggle} ${speakEnabled ? styles.voiceToggleOn : ""}`}
              onClick={handleSpeakToggle}
            >
              {speakEnabled ? "🔊 Voice On" : "🔇 Voice Off"}
            </button>
            <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">✕</button>
          </div>
        </div>

        {/* ── Progress bar ── */}
        <div className={styles.progressWrap}>
          <div className={styles.progressBar} style={{ width: `${progress}%` }} />
        </div>

        {/* ── Voice toolbar ── */}
        {supported && (
          <div className={styles.toolbar}>
            <select
              className={styles.select}
              value={selectedVoiceName}
              onChange={e => setSelectedVoiceName(e.target.value)}
            >
              <option value="">Default Voice</option>
              {filteredVoices.map(v => (
                <option key={`${v.name}-${v.lang}`} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
            <div className={styles.presetRow}>
              {presets.map(p => (
                <button
                  key={p.id}
                  className={`${styles.presetBtn} ${preferredVoice && p.test.test(`${preferredVoice.name} ${preferredVoice.lang}`) ? styles.presetActive : ""}`}
                  onClick={() => applyPreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button className={styles.presetBtn} onClick={refreshVoices}>↻ Reload</button>
            <div className={styles.sliderGroup}>
              <span className={styles.label}>Pitch</span>
              <input type="range" min="0.5" max="2" step="0.1" value={speechPitch}
                onChange={e => setSpeechPitch(Number(e.target.value))} />
            </div>
          </div>
        )}

        {/* ── Story text ── */}
        <div className={styles.contentArea}>
          <pre className={styles.storyText}>
            {typedText}
            {isTyping && <span className={styles.cursor} />}
          </pre>
        </div>

        {/* ── Controls ── */}
        <div className={styles.controls}>
          <button
            className={`${styles.controlBtn} ${styles.controlBtnPrimary}`}
            onClick={handleTogglePlay}
          >
            {isTyping ? "⏸ Pause" : "▶ Play"}
          </button>
          <button className={styles.controlBtn} onClick={handleRestart}>↺ Restart</button>
          <div className={styles.sliderGroup}>
            <span className={styles.label}>Speed</span>
            <input type="range" min="4" max="40" value={typingSpeed}
              onChange={e => setTypingSpeed(Number(e.target.value))} />
          </div>
          {speakEnabled && (
            <div className={styles.sliderGroup}>
              <span className={styles.label}>Rate</span>
              <input type="range" min="0.7" max="1.4" step="0.1" value={speechRate}
                onChange={e => setSpeechRate(Number(e.target.value))} />
            </div>
          )}
          <div className={styles.spacer} />
          <button
            className={styles.controlBtn}
            onClick={handleNext}
            disabled={isLoading || (!originalPrompt && stories.length <= 1)}
          >
            Next ›
          </button>
        </div>

        {/* ── Equalizer ── */}
        {speakEnabled && (
          <div className={styles.eq} aria-hidden="true">
            {[...Array(5)].map((_, i) => <div key={i} className={styles.eqBar} />)}
          </div>
        )}
      </div>
    </div>
  );
};

export default StoryModal;
