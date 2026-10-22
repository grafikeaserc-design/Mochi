document.addEventListener("DOMContentLoaded", () => {
    // --- 0. SPLASH SCREEN DISMISSAL ---
    const splashScreen = document.getElementById("splashscreen");
    if (splashScreen) {
        setTimeout(() => {
            splashScreen.classList.add("fade-out");
            setTimeout(() => splashScreen.remove(), 600);
        }, 1200);
    }

    // --- 1. APP STATE & TOOL EXECUTOR ---
    const tools = typeof ToolExecutor !== "undefined" ? new ToolExecutor() : null;
    
    const state = {
        events: JSON.parse(localStorage.getItem('assistant_tasks') || '[]'),
        alarms: [
            { id: 1, time: "07:30 AM", label: "Morning Wakeup", active: true }
        ]
    };

    // --- DOM ELEMENTS ---
    const greetingSection = document.querySelector(".greeting-section");
    const assistantHero = document.querySelector(".assistant-hero");
    const chipsGrid = document.getElementById("action-chips");
    const chatForm = document.getElementById("chat-form");
    const chatInput = document.getElementById("chat-input");
    const chatMessages = document.getElementById("chat-messages");
    const navItems = document.querySelectorAll(".nav-item");
    const views = document.querySelectorAll(".screen-view");
    const actionChips = document.querySelectorAll(".chip-btn");
    const exitDeskBtn = document.getElementById("exit-desk-btn");
    const appContainer = document.querySelector(".app-container");
    const navbar = document.getElementById("navbar");
    const deskMicBtn = document.getElementById("desk-mic-btn");
    const deskStatusText = document.getElementById("desk-status-text");

    // --- 2. TEXT CLASSIFIER ---
    class TextClassifier {
        constructor(modelData) {
            this.model = modelData;
            this.vocab = this.model.vocabulary;
            this.idf = this.model.idf || [];
            this.useIdf = this.model.use_idf ?? false;
            this.ngramMin = this.model.ngram_min || 1;
            this.ngramMax = this.model.ngram_max || 1;
            this.coef = this.model.coef;
            this.intercept = this.model.intercept;
            this.classes = this.model.classes;
            
            let rawPattern = this.model.token_pattern || '\\b\\w\\w+\\b';
            rawPattern = rawPattern.replace(/^\(\?u\)/, ''); 
            this.tokenPattern = new RegExp(rawPattern, 'g');
        }

        static async load(jsonPath) {
            const response = await fetch(jsonPath);
            if (!response.ok) throw new Error(`Failed to load model weights`);
            return new TextClassifier(await response.json());
        }

        tokenize(text) {
            if (this.model.lowercase) text = text.toLowerCase();
            return text.match(this.tokenPattern) || [];
        }

        extractNgrams(tokens) {
            const ngrams = [];
            for (let n = this.ngramMin; n <= this.ngramMax; n++) {
                for (let i = 0; i <= tokens.length - n; i++) {
                    ngrams.push(tokens.slice(i, i + n).join(' '));
                }
            }
            return ngrams;
        }

        vectorize(text) {
            const tokens = this.tokenize(text);
            const ngrams = this.extractNgrams(tokens);
            const termCounts = {};
            for (const gram of ngrams) {
                if (gram in this.vocab) termCounts[gram] = (termCounts[gram] || 0) + 1;
            }
            const vector = new Array(Object.keys(this.vocab).length).fill(0);
            let sumSquares = 0;
            for (const [gram, count] of Object.entries(termCounts)) {
                const idx = this.vocab[gram];
                let tf = count;
                if (this.useIdf && this.idf.length > 0) tf = tf * this.idf[idx];
                vector[idx] = tf;
                sumSquares += tf * tf;
            }
            if (sumSquares > 0) {
                const norm = Math.sqrt(sumSquares);
                for (let i = 0; i < vector.length; i++) vector[i] /= norm;
            }
            return vector;
        }

        predict(text) {
            const x = this.vectorize(text);
            const numClasses = this.classes.length;
            const scores = [];
            const iterations = numClasses === 2 ? 1 : numClasses;

            for (let c = 0; c < iterations; c++) {
                let score = this.intercept[c];
                for (let i = 0; i < x.length; i++) {
                    if (x[i] !== 0) score += x[i] * this.coef[c][i];
                }
                scores.push(score);
            }

            if (numClasses === 2) {
                const prob = 1 / (1 + Math.exp(-scores[0]));
                return { predicted: prob >= 0.5 ? this.classes[1] : this.classes[0], confidence: prob };
            } else {
                const maxScore = Math.max(...scores);
                const expScores = scores.map(s => Math.exp(s - maxScore));
                const sumExp = expScores.reduce((a, b) => a + b, 0);
                const probabilities = expScores.map(s => s / sumExp);
                let maxIdx = 0;
                for (let i = 1; i < probabilities.length; i++) {
                    if (probabilities[i] > probabilities[maxIdx]) maxIdx = i;
                }
                return { predicted: this.classes[maxIdx], confidence: probabilities[maxIdx] };
            }
        }
    }

    // --- 3. WEB ASSISTANT ---
    class WebAssistant {
        constructor() {
            this.classifier = null;
            this.responses = {};
        }

        async init() {
            try {
                this.classifier = await TextClassifier.load('./model_weights.json');
                const res = await fetch('./conversation/conversation.json');
                if (res.ok) this.responses = await res.json();
                const statusEl = document.getElementById('status');
                if (statusEl) statusEl.innerText = "Mochi Ready";
            } catch (err) {
                const statusEl = document.getElementById('status');
                if (statusEl) statusEl.innerText = "Mochi Ready";
            }
        }

        extractSlots(text, intent) {
            let slots = {
                title: text,
                time: "10:00 AM",
                date: "2026-10-24",
                task_name: text,
                amount: "100",
                category: "general",
                query: text,
                app_name: text,
                theme: "dark",
                duration: "15 minutes"
            };

            if (intent === "Set_Reminder" || intent === "Set_Alarm") {
                const timeMatch = text.match(/(?:at|in)\s+([\d:]+\s*(?:AM|PM|am|pm)?|\d+\s*\w+)/);
                if (timeMatch) slots.time = timeMatch[0];
            } else if (intent === "Schedule_Event" || intent === "Create_Task") {
                const timeMatch = text.match(/(?:at|on)\s+([\d:]+\s*(?:AM|PM|am|pm)?|\w+)/i);
                if (timeMatch) slots.time = timeMatch[0];
                slots.title = text.replace(/^(schedule|book|set up|create task|add)\s*/i, '').replace(/\s*(?:at|on)\s+.*$/, '').trim();
                slots.task_name = slots.title;
            }
            return slots;
        }

        handleMessage(userInput) {
            let intent = "General_Chat";
            let confidence = 1.0;

            if (this.classifier) {
                const prediction = this.classifier.predict(userInput);
                intent = prediction.predicted;
                confidence = prediction.confidence;
            } else {
                const lower = userInput.toLowerCase();
                if (lower.includes("alarm")) intent = "Set_Alarm";
                else if (lower.includes("schedule") || lower.includes("meeting")) intent = "Schedule_Event";
                else if (lower.includes("task") || lower.includes("todo")) intent = "Create_Task";
                else if (lower.includes("search")) intent = "Web_Search";
                else if (lower.includes("open")) intent = "Open_App";
            }

            const slots = this.extractSlots(userInput, intent);
            
            let toolResult = { success: true };
            if (tools) {
                toolResult = tools.execute(intent, slots, userInput);
                if (toolResult && toolResult.result !== undefined) slots.result = toolResult.result;
            }

            if (intent === "Create_Task" || intent === "Schedule_Event") {
                state.events.push({ id: Date.now(), title: slots.title || slots.task_name, date: slots.date, time: slots.time });
                renderCalendar();
                renderLists();
            }

            const defaultTemplates = [`I'm on it! Processed request for ${intent.replace(/_/g, ' ').toLowerCase()}.`];
            const templates = this.responses[intent] || defaultTemplates;
            let template = templates[Math.floor(Math.random() * templates.length)];

            for (const [key, val] of Object.entries(slots)) {
                template = template.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
            }

            if (toolResult && toolResult.extra) {
                template += toolResult.extra;
            }

            return { response: template, intent: intent, confidence: confidence };
        }
    }

    const assistant = new WebAssistant();
    assistant.init();

    // --- 4. NAVIGATION ROUTER & DESK MODE ROTATION ---
    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const targetViewId = item.getAttribute("data-target");
            switchView(targetViewId);
        });
    });

    function switchView(targetViewId) {
        navItems.forEach(nav => {
            nav.classList.toggle("active", nav.getAttribute("data-target") === targetViewId);
        });
        
        views.forEach(view => {
            if (view.id === targetViewId) {
                view.classList.add("active-view");
            } else {
                view.classList.remove("active-view");
            }
        });

        // Desk Mode specific container adjustments
        if (targetViewId === "view-desk") {
            if (appContainer) appContainer.classList.add("desk-rotated-mode");
            if (navbar) navbar.classList.add("hidden");
        } else {
            if (appContainer) appContainer.classList.remove("desk-rotated-mode");
            if (navbar) navbar.classList.remove("hidden");
        }
    }

    if (exitDeskBtn) {
        exitDeskBtn.addEventListener("click", () => switchView("view-chat"));
    }

    // Desk Mode Voice Interaction Simulation
    if (deskMicBtn) {
        deskMicBtn.addEventListener("click", () => {
            const isListening = deskMicBtn.classList.toggle("listening");
            if (isListening) {
                if (deskStatusText) deskStatusText.textContent = "Listening to your voice...";
                
                setTimeout(() => {
                    deskMicBtn.classList.remove("listening");
                    if (deskStatusText) deskStatusText.textContent = "Processing request...";
                    
                    setTimeout(() => {
                        if (deskStatusText) deskStatusText.textContent = "Tap mic to speak with Mochi";
                    }, 2000);
                }, 3000);
            } else {
                if (deskStatusText) deskStatusText.textContent = "Tap mic to speak with Mochi";
            }
        });
    }

    // Action Chips Handler
    actionChips.forEach(chip => {
        chip.addEventListener("click", () => {
            chatInput.value = chip.getAttribute("data-prompt");
            chatInput.focus();
        });
    });

    // --- CHAT FORM SUBMIT HANDLER ---
    chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;

        if (chipsGrid) chipsGrid.classList.add("hidden");
        if (greetingSection) greetingSection.classList.add("hidden");
        if (assistantHero) assistantHero.classList.add("compact");

        appendMessage(text, "user-msg");
        chatInput.value = "";

        setTimeout(() => {
            const result = assistant.handleMessage(text);
            appendMessage(result.response, "assistant-msg");
        }, 300);
    });

    function appendMessage(text, className) {
        if (!chatMessages) return;
        const msgDiv = document.createElement("div");
        msgDiv.className = `message ${className}`;
        msgDiv.textContent = text;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // --- 5. CALENDAR & LIST RENDERERS ---
    function renderCalendar() {
        const daysContainer = document.getElementById("calendar-days");
        if (!daysContainer) return;

        daysContainer.innerHTML = "";
        const startDayIndex = 4;
        const totalDays = 31;

        for (let i = 0; i < startDayIndex; i++) {
            const emptyCell = document.createElement("div");
            daysContainer.appendChild(emptyCell);
        }

        for (let day = 1; day <= totalDays; day++) {
            const dayCell = document.createElement("div");
            dayCell.className = "day-cell";
            dayCell.style.cssText = "aspect-ratio:1; display:flex; flex-direction:column; align-items:center; justify-content:center; border-radius:8px; border:1px solid #eaeaea; font-size:0.85rem; position:relative;";
            dayCell.textContent = day;

            if (day === 24) dayCell.style.background = "rgba(139,126,248,0.2)";

            const dateStr = `2026-10-${String(day).padStart(2, '0')}`;
            if (state.events.some(e => e.date === dateStr || (e.date && e.date.includes(dateStr)))) {
                const dot = document.createElement("div");
                dot.style.cssText = "width:5px; height:5px; background:#8b7ef8; border-radius:50%; position:absolute; bottom:4px;";
                dayCell.appendChild(dot);
            }

            daysContainer.appendChild(dayCell);
        }
    }

    function renderLists() {
        const eventList = document.getElementById("event-list");
        const storedTasks = JSON.parse(localStorage.getItem('assistant_tasks') || '[]');

        if (eventList) {
            eventList.innerHTML = storedTasks.length === 0 && state.events.length === 0
                ? `<li class="empty-state" style="color:#888; font-size:0.85rem;">No scheduled tasks yet.</li>`
                : [...state.events, ...storedTasks].map(ev => `
                    <li class="item-card" style="background:#f8f9fa; padding:8px 12px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; font-size:0.9rem;">
                        <div><strong>${ev.task || ev.title}</strong></div>
                        <i class="fa-regular fa-calendar-check" style="color:var(--primary-purple, #8b7ef8);"></i>
                    </li>
                `).join('');
        }
    }

    renderCalendar();
    renderLists();
});