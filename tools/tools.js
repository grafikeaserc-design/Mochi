class ToolExecutor {
    constructor() {
        if (typeof window !== 'undefined' && !localStorage.getItem('assistant_tasks')) {
            localStorage.setItem('assistant_tasks', JSON.stringify([]));
        }
    }

    execute(intent, slots = {}, rawText = '') {
        try {
            switch (intent) {
                case "Create_Task":
                    return this.createTask(slots.task_name || rawText);
                case "Schedule_Event":
                    return this.scheduleEvent(slots.title || slots.task_name, slots.date, slots.time);
                case "Set_Reminder":
                    return this.setReminder(slots.title || slots.task_name || rawText, slots.time, slots.date);
                case "Set_Alarm":
                    return this.setAlarm(slots.time, slots.title || rawText);
                case "Cancel_Event":
                case "Delete_Task":
                    return this.cancelTask(slots.task_name || slots.title || rawText);
                case "Quick_Calculate":
                    return this.calculateExpression(slots.expression || rawText);
                case "Timer_Set":
                    return this.setTimer(slots.duration || rawText);
                case "Cancel_Alarm":
                    return this.cancelAlarm(slots.alarm_name || rawText);
                case "Web_Search":
                    return this.performWebSearch(slots.query || rawText);
                case "Open_App": 
                case "Launch_Workspace":
                    return this.openApp(slots.app_name || slots.query || rawText);
                default:
                    return { success: true, message: "Action completed.", result: null };
            }
        } catch (error) {
            console.error(`Tool execution error for intent "${intent}":`, error);
            return { success: false, error: error.message };
        }
    }

    createTask(taskName) {
        const name = (taskName || '').trim();
        if (!name) {
            return { success: false, error: "Task name cannot be empty." };
        }
        try {
            const tasks = JSON.parse(localStorage.getItem('assistant_tasks') || '[]');
            tasks.push({ id: Date.now(), task: name, title: name, completed: false, date: new Date().toISOString().split('T')[0] });
            localStorage.setItem('assistant_tasks', JSON.stringify(tasks));
            return { success: true, message: `Task "${name}" created.`, extra: " Saved to your local task list!" };
        } catch (e) {
            return { success: false, error: "Failed to access local storage for tasks." };
        }
    }

    setReminder(title, time, date) {
        const reminderTitle = (title || '').trim();
        if (!reminderTitle) {
            return { success: false, error: "Reminder title cannot be empty." };
        }
        try {
            const tasks = JSON.parse(localStorage.getItem('assistant_tasks') || '[]');
            tasks.push({
                id: Date.now(),
                title: reminderTitle,
                task: `Reminder: ${reminderTitle}`,
                date: date || new Date().toISOString().split('T')[0],
                time: time || "10:00 AM",
                completed: false
            });
            localStorage.setItem('assistant_tasks', JSON.stringify(tasks));
            return { success: true, message: `Reminder set for '${reminderTitle}' at ${time || '10:00 AM'}.`, extra: " Added to your schedule!" };
        } catch (e) {
            return { success: false, error: "Failed to set reminder." };
        }
    }

    setAlarm(timeStr, label) {
        const time = (timeStr || '07:00 AM').trim();
        const alarmLabel = (label || 'Alarm')
            .replace(/^(set|create|add)\s+(an\s+)?alarm(\s+for)?\s*/i, '')
            .replace(/(?:at|for)\s+[\d:]+\s*(?:AM|PM|am|pm)?/gi, '')
            .trim() || 'Alarm';

        try {
            const alarms = JSON.parse(localStorage.getItem('assistant_alarms') || '[]');
            const newAlarm = {
                id: Date.now(),
                time: time,
                label: alarmLabel,
                active: true
            };
            alarms.push(newAlarm);
            localStorage.setItem('assistant_alarms', JSON.stringify(alarms));

            return { success: true, message: `Alarm set for ${time}.`, extra: ` Alarm set for ${time} (${alarmLabel}).` };
        } catch (e) {
            return { success: false, error: "Failed to set alarm." };
        }
    }

    cancelAlarm(identifier) {
        const cleanName = (identifier || '')
            .replace(/^(cancel|delete|remove|clear)\s+(the\s+)?(alarm)?\s*/i, '')
            .trim()
            .toLowerCase();
        
        if (!cleanName) {
            return { success: false, error: "Please specify which alarm to cancel." };
        }

        try {
            let alarms = JSON.parse(localStorage.getItem('assistant_alarms') || '[]');
            const initialLength = alarms.length;
            
            alarms = alarms.filter(a => {
                const label = (a.label || '').toLowerCase();
                const time = (a.time || '').toLowerCase();
                return !label.includes(cleanName) && !cleanName.includes(label) && !time.includes(cleanName);
            });

            if (alarms.length === initialLength) {
                return { success: false, message: `No active alarm found matching "${cleanName}".`, extra: " Couldn't find that alarm." };
            }

            localStorage.setItem('assistant_alarms', JSON.stringify(alarms));
            return { success: true, message: `Cancelled alarm for "${cleanName}".`, extra: " Successfully removed alarm!" };
        } catch (e) {
            return { success: false, error: "Failed to update alarms storage." };
        }
    }
    
    scheduleEvent(title, date, time) {
        const eventTitle = (title || '').trim();
        if (!eventTitle) {
            return { success: false, error: "Event title cannot be empty." };
        }
        try {
            const tasks = JSON.parse(localStorage.getItem('assistant_tasks') || '[]');
            tasks.push({ 
                id: Date.now(), 
                title: eventTitle, 
                task: eventTitle,
                date: date || new Date().toISOString().split('T')[0], 
                time: time || "10:00 AM",
                completed: false 
            });
            localStorage.setItem('assistant_tasks', JSON.stringify(tasks));
            return { success: true, message: `Locked in '${eventTitle}' for ${time || '10:00 AM'} on ${date || 'today'}.`, extra: " Saved to your schedule!" };
        } catch (e) {
            return { success: false, error: "Failed to save event." };
        }
    }

    cancelTask(identifier) {
        const cleanName = (identifier || '')
            .replace(/^(cancel|delete|remove|clear)\s+(the\s+)?(event|task|meeting)?\s*/i, '')
            .trim()
            .toLowerCase();
        
        if (!cleanName) {
            return { success: false, error: "Please specify what to cancel." };
        }

        try {
            let tasks = JSON.parse(localStorage.getItem('assistant_tasks') || '[]');
            const initialLength = tasks.length;
            
            tasks = tasks.filter(t => {
                const taskTitle = (t.task || t.title || '').toLowerCase();
                return !taskTitle.includes(cleanName) && !cleanName.includes(taskTitle);
            });

            if (tasks.length === initialLength) {
                return { success: false, message: `No scheduled task or event found matching "${cleanName}".`, extra: " Couldn't find that task in your list." };
            }

            localStorage.setItem('assistant_tasks', JSON.stringify(tasks));
            return { success: true, message: `Cancelled '${cleanName}'.`, extra: " Successfully removed from your schedule!" };
        } catch (e) {
            return { success: false, error: "Failed to update local storage." };
        }
    }

    calculateExpression(text) {
        const expr = (text || '').trim();
        if (!expr) {
            return { success: false, error: "Expression cannot be empty." };
        }
        try {
            const cleanExpr = expr.replace(/[^0-9+\-*/().%\s]/g, '');
            if (!cleanExpr) {
                return { success: false, error: "Invalid mathematical expression." };
            }
            const result = Function(`'use strict'; return (${cleanExpr})`)();
            return { success: true, result: result, message: `Result: ${result}` };
        } catch (e) {
            return { success: false, error: "Error calculating expression." };
        }
    }

    setTimer(durationStr) {
        const str = (durationStr || '').trim();
        const match = str.match(/(\d+)\s*(min|sec|m|s|minutes|seconds)?/i);
        if (!match) {
            return { success: false, error: "Invalid timer duration format." };
        }
        const value = parseInt(match[1], 10);
        const unit = (match[2] || 'min').toLowerCase();
        let ms = value * 60 * 1000;
        if (unit.startsWith('s')) {
            ms = value * 1000;
        }

        setTimeout(() => {
            if (typeof window !== 'undefined' && typeof alert === 'function') {
                alert(`⏰ Timer finished for ${str}!`);
            }
        }, ms);

        return { success: true, message: `Timer started for ${str}.`, extra: ` Countdown started for ${str}.` };
    }

    performWebSearch(query) {
        const searchQuery = (query || '').trim();
        if (!searchQuery) {
            return { success: false, error: "Search query cannot be empty." };
        }
        const encodedQuery = encodeURIComponent(searchQuery);
        if (typeof window !== 'undefined') {
            window.open(`https://www.google.com/search?q=${encodedQuery}`, '_blank');
        }
        return { success: true, message: `Searching for "${searchQuery}".`, extra: " Opening search results in a new tab." };
    }

    openApp(appName) {
        let cleanName = (appName || '').toLowerCase().trim();
        if (!cleanName) {
            return { success: false, error: "App or workspace name cannot be empty." };
        }

        const stopWords = ['open the app', 'open app', 'launch app', 'start app', 'open', 'launch', 'start', 'go to', 'run'];
        for (const word of stopWords) {
            if (cleanName.startsWith(word)) {
                cleanName = cleanName.replace(word, '').trim();
            }
        }

        if (!cleanName) {
            return { success: false, error: "App or workspace name cannot be empty." };
        }

        const appMap = {
            "github": "https://github.com",
            "youtube": "https://youtube.com",
            "jira": "https://jira.com",
            "email": "https://mail.google.com",
            "gmail": "https://mail.google.com",
            "google": "https://google.com",
            "chatgpt": "https://chatgpt.com",
            "twitter": "https://twitter.com",
            "x": "https://twitter.com",
            "reddit": "https://reddit.com",
            "linkedin": "https://linkedin.com",
            "stackoverflow": "https://stackoverflow.com",
            "notion": "https://notion.so"
        };
        
        const key = Object.keys(appMap).find(k => cleanName.includes(k));
        
        if (key) {
            const url = appMap[key];
            if (typeof window !== 'undefined') {
                window.open(url, '_blank');
            }
            return { success: true, message: `Opened ${cleanName}.`, extra: ` Opening ${cleanName} in a new tab.` };
        } else {
            return this.performWebSearch(cleanName);
        }
    }
}