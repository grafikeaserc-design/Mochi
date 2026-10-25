document.addEventListener("DOMContentLoaded", () => {
    // --- 0. SPLASH SCREEN DISMISSAL ---
    const splashScreen = document.getElementById("splashscreen");
    if (splashScreen) {
        setTimeout(() => {
            splashScreen.classList.add("fade-out");
            setTimeout(() => splashScreen.remove(), 600);
        }, 2200);
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
            // Use actual current date (or set to new Date(2026, 9, 25) if testing with a mock date)
            const today = new Date(); 
            let targetDate = new Date(today);
            const lowerText = text.toLowerCase();

            // Day of week / Date parsing
            const daysMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
            let matchedDay = null;
            for (const [dayName, dayIndex] of Object.entries(daysMap)) {
                const regex = new RegExp(`\\b(on|this|next)?\\s*${dayName}\\b`, 'i');
                if (regex.test(lowerText)) {
                    matchedDay = dayIndex;
                    break;
                }
            }

            if (lowerText.includes('tomorrow')) {
                targetDate.setDate(today.getDate() + 1);
            } else if (lowerText.includes('day after tomorrow')) {
                targetDate.setDate(today.getDate() + 2);
            } else if (lowerText.includes('today')) {
                targetDate.setDate(today.getDate());
            } else if (matchedDay !== null) {
                const currentDay = today.getDay();
                let diff = matchedDay - currentDay;
                
                // If the day has already passed this week (or is today and you want the upcoming one), push to next week
                if (diff <= 0) {
                    diff += 7;
                }
                targetDate.setDate(today.getDate() + diff);
            }

            const year = targetDate.getFullYear();
            const month = String(targetDate.getMonth() + 1).padStart(2, '0');
            const day = String(targetDate.getDate()).padStart(2, '0');
            const formattedDate = `${year}-${month}-${day}`;

            let slots = {
                title: text,
                time: "10:00 AM",
                date: formattedDate,
                task_name: text,
                query: text,
                app_name: text,
                duration: "15 minutes"
            };

            if (intent === "Set_Alarm") {
                const timeMatch = text.match(/(?:at|for)\s+([\d:]+\s*(?:AM|PM|am|pm)?)/i);
                if (timeMatch) slots.time = timeMatch[1].trim();

                let cleanTitle = text
                    .replace(/^(set|create|add)\s+(an\s+)?alarm\s*/i, '')
                    .replace(/(?:at|for)\s+[\d:]+\s*(?:AM|PM|am|pm)?/gi, '')
                    .replace(/^\b(for|at)\b/i, '')
                    .replace(/\s+/g, ' ')
                    .trim();

                slots.title = cleanTitle || "Alarm";
                slots.task_name = slots.title;
            } else if (intent === "Set_Reminder" || intent === "Schedule_Event" || intent === "Create_Task") {
                const timeMatch = text.match(/(?:at|in|on|for)\s+([\d:]+\s*(?:AM|PM|am|pm)?|\d+\s*(?:min|hour|hr|m|h)s?)/i);
                if (timeMatch && timeMatch[1]) {
                    slots.time = timeMatch[1].trim();
                }

                let cleanTitle = text
                    .replace(/^(schedule|book|set up|create task|add|remind me to|reminder to|create)\s*(an?|the)?\s*/i, '')
                    .replace(/\b(next\s+)?(coming\s+)?(on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|yesterday|day after tomorrow)\b/gi, '')
                    .replace(/(?:at|on|for|by)\s+([\d:]+\s*(?:AM|PM|am|pm)?|\d+\s*(?:min|hour|hr|m|h)s?)/gi, '')
                    .replace(/^(on|for|at|to|a|an)\s+/i, '')
                    .replace(/\s+(on|for|at|to|a|an)$/i, '')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (cleanTitle) {
                    slots.title = cleanTitle;
                    slots.task_name = cleanTitle;
                }
            } else if (intent === "Open_App" || intent === "Launch_Workspace") {
                slots.app_name = text.replace(/^(open the app|open app|launch app|start app|open|launch|start|go to|run)\s*/i, '').trim();
            } else if (intent === "Web_Search") {
                slots.query = text.replace(/^(search for|search|google)\s*/i, '').trim();
            } else if (intent === "Cancel_Event" || intent === "Delete_Task" || intent === "Cancel_Reminder") {
                slots.task_name = text
                    .replace(/^(cancel|delete|remove|clear)\s+(the\s+)?(event|task|meeting|reminder)?\s*/i, '')
                    .trim();
                slots.title = slots.task_name;
            } else if (intent === "Cancel_Alarm") {
                slots.alarm_name = text
                    .replace(/^(cancel|delete|remove|clear)\s+(the\s+)?(alarm)?\s*/i, '')
                    .trim();
            }

            return slots;
        }

        handleMessage(userInput) {
            let intent = "Fallback";
            let confidence = 1.0;
            const lower = userInput.toLowerCase();

            if (lower.includes("alarm")) {
                intent = "Set_Alarm";
            } else if (lower.includes("reminder") || lower.includes("remind")) {
                intent = "Set_Reminder";
            } else if (lower.includes("cancel") || lower.includes("delete") || lower.includes("remove")) {
                intent = lower.includes("alarm") ? "Cancel_Alarm" : "Cancel_Event";
            } else if (lower.includes("schedule") || lower.includes("meeting") || lower.includes("book")) {
                intent = "Schedule_Event";
            } else if (lower.includes("task") || lower.includes("todo")) {
                intent = "Create_Task";
            } else if (lower.includes("search") || lower.includes("google")) {
                intent = "Web_Search";
            } else if (lower.includes("open") || lower.includes("launch")) {
                intent = "Open_App";
            } else if (this.classifier) {
                const prediction = this.classifier.predict(userInput);
                intent = prediction.predicted;
                confidence = prediction.confidence;
                if (confidence < 0.5) {
                    intent = "Fallback";
                }
            } else {
                intent = "Fallback";
            }

            const slots = this.extractSlots(userInput, intent);
            
            let toolResult = { success: true };
            if (tools && intent !== "Fallback") {
                toolResult = tools.execute(intent, slots, userInput);
                if (toolResult && toolResult.result !== undefined) slots.result = toolResult.result;
            } else {
                toolResult = { success: false, error: "Fallback intent triggered" };
            }

            if (toolResult && toolResult.success && ["Create_Task", "Schedule_Event", "Set_Reminder", "Cancel_Event", "Delete_Task"].includes(intent)) {
                state.events = JSON.parse(localStorage.getItem('assistant_tasks') || '[]');
                renderCalendar();
                renderLists();
            }

            const defaultTemplates = [`I'm not quite sure how to help with that. Could you please clarify?`];
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

    // --- 4. NAVIGATION ROUTER ---
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

        state.events = JSON.parse(localStorage.getItem('assistant_tasks') || '[]');
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
        state.events = JSON.parse(localStorage.getItem('assistant_tasks') || '[]');

        if (eventList) {
            eventList.innerHTML = state.events.length === 0
                ? `<li class="empty-state" style="color:#888; font-size:0.85rem;">No scheduled tasks yet.</li>`
                : state.events.map(ev => `
                    <li class="item-card" style="background:#f8f9fa; padding:8px 12px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; font-size:0.9rem;">
                        <div><strong>${ev.task || ev.title}</strong> (${ev.time || 'All Day'})</div>
                        <i class="fa-regular fa-calendar-check" style="color:var(--primary-purple, #8b7ef8);"></i>
                    </li>
                `).join('');
        }
    }

    renderCalendar();
    renderLists();

    // --- 6. TOAST NOTIFICATIONS & REAL-TIME ALARM/SCHEDULE CHECKER ---

    // Function to trigger UI Toast Notification
    function showToast(message, title = "Notification") {
        const container = document.getElementById("toast-container");
        if (!container) return;

        const toast = document.createElement("div");
        toast.style.cssText = `
            background: #ffffff;
            color: #333333;
            border-left: 4px solid #8b7ef8;
            padding: 12px 18px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            min-width: 250px;
            font-family: inherit;
            animation: slideIn 0.3s ease-out forwards;
        `;

        toast.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 4px; color: #8b7ef8; display: flex; align-items: center; gap: 6px;">
                <i class="fa-solid fa-bell"></i> ${title}
            </div>
            <div style="font-size: 0.9rem;">${message}</div>
        `;

        container.appendChild(toast);

        // Remove toast after 5 seconds
        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transition = "opacity 0.4s ease";
            setTimeout(() => toast.remove(), 400);
        }, 5000);
    }

    // Convert standard time strings (e.g. "10:00 AM", "7:30 PM") to 24h format "HH:MM"
    function formatTo24Hour(timeStr) {
        if (!timeStr) return "";
        const match = timeStr.trim().match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/i);
        if (!match) return "";

        let hours = parseInt(match[1], 10);
        const minutes = match[2] ? match[2] : "00";
        const period = match[3] ? match[3].toUpperCase() : null;

        if (period === "PM" && hours < 12) hours += 12;
        if (period === "AM" && hours === 12) hours = 0;

        return `${String(hours).padStart(2, '0')}:${minutes}`;
    }

    // Real-Time Checker Loop
    function checkSchedulesAndAlarms() {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
        const currentDay = String(now.getDate()).padStart(2, '0');
        const currentDate = `${currentYear}-${currentMonth}-${currentDay}`; // "YYYY-MM-DD"
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; // "HH:MM"

        // 1. Check Scheduled Tasks for Today
        const tasks = JSON.parse(localStorage.getItem('assistant_tasks') || '[]');
        tasks.forEach(task => {
            const taskTime24 = formatTo24Hour(task.time);
            
            // Check if task is today and matches current hour & minute
            if (task.date === currentDate && taskTime24 === currentTime && !task.notified) {
                showToast(`It's time for: "${task.title || task.task}"`, "Schedule Reminder");
                task.notified = true; // Prevents repeating toasts within the same minute
            }
        });
        localStorage.setItem('assistant_tasks', JSON.stringify(tasks));

        // 2. Check Active Alarms
        const alarms = JSON.parse(localStorage.getItem('assistant_alarms') || '[]');
        alarms.forEach(alarm => {
            const alarmTime24 = formatTo24Hour(alarm.time);

            if (alarm.active && alarmTime24 === currentTime && !alarm.notified) {
                showToast(`Alarm ringing: "${alarm.label || 'Alarm'}" (${alarm.time})`, "⏰ Alarm");
                alarm.notified = true; // Prevents repeating toasts within the same minute
            }
        });
        localStorage.setItem('assistant_alarms', JSON.stringify(alarms));
    }

    // Run interval every 10 seconds to check time triggers
    setInterval(checkSchedulesAndAlarms, 40000);
});