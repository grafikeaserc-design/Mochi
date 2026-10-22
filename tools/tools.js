class ToolExecutor {
    constructor() {
        if (!localStorage.getItem('assistant_expenses')) localStorage.setItem('assistant_expenses', JSON.stringify([]));
        if (!localStorage.getItem('assistant_tasks')) localStorage.setItem('assistant_tasks', JSON.stringify([]));
    }

    execute(intent, slots, rawText) {
        switch (intent) {
            case "Log_Expense":
                return this.logExpense(slots.amount, slots.category);
            case "Create_Task":
                return this.createTask(slots.task_name);
            case "Quick_Calculate":
                return this.calculateExpression(rawText);
            case "Timer_Set":
                return this.setTimer(slots.duration);
            case "Web_Search":
                return this.performWebSearch(slots.query);
            case "Open_App": 
            case "Launch_Workspace": // <-- Handled here now
                return this.openApp(slots.app_name || rawText);
            case "Toggle_Theme":
                return this.toggleTheme(slots.theme);
            case "Clear_Clipboard":
                return this.clearClipboard();
            default:
                return { success: true, message: "Action completed." };
        }
    }

    logExpense(amount, category) {
        const expenses = JSON.parse(localStorage.getItem('assistant_expenses'));
        expenses.push({ amount: parseFloat(amount), category, date: new Date().toISOString() });
        localStorage.setItem('assistant_expenses', JSON.stringify(expenses));
        const total = expenses.reduce((sum, item) => sum + item.amount, 0);
        return { success: true, extra: ` (Total spent so far: ₹${total})` };
    }

    createTask(taskName) {
        const tasks = JSON.parse(localStorage.getItem('assistant_tasks'));
        tasks.push({ task: taskName, completed: false, date: new Date().toISOString() });
        localStorage.setItem('assistant_tasks', JSON.stringify(tasks));
        return { success: true, extra: " Saved to your local task list!" };
    }

    calculateExpression(text) {
        try {
            const cleanExpr = text.replace(/[^0-9+\-*/().%\s]/g, '').trim();
            const result = Function(`'use strict'; return (${cleanExpr})`)();
            return { success: true, result: result };
        } catch (e) {
            return { success: false, result: "Error calculating expression" };
        }
    }

    setTimer(durationStr) {
        const match = durationStr.match(/(\d+)\s*(min|sec|m|s)?/i);
        if (!match) return { success: false };
        const value = parseInt(match[1]);
        const unit = (match[2] || 'min').toLowerCase();
        let ms = value * 60 * 1000;
        if (unit.startsWith('s')) ms = value * 1000;

        setTimeout(() => {
            alert(`⏰ Timer finished for ${durationStr}!`);
        }, ms);
        return { success: true, extra: ` Countdown started for ${durationStr}.` };
    }

    performWebSearch(query) {
        const encodedQuery = encodeURIComponent(query);
        window.open(`https://www.google.com/search?q=${encodedQuery}`, '_blank');
        return { success: true, extra: " Opening search results in a new tab." };
    }

    openApp(appName) {
        const appMap = {
            "github": "https://github.com",
            "youtube": "https://youtube.com",
            "jira": "https://jira.com",
            "email": "https://mail.google.com",
            "gmail": "https://mail.google.com",
            "google": "https://google.com"
        };
        
        // Clean up input string to look for matches safely
        const cleanName = appName.toLowerCase().trim();
        const key = Object.keys(appMap).find(k => cleanName.includes(k));
        
        const url = key ? appMap[key] : `https://www.google.com/search?q=${encodeURIComponent(appName)}`;
        
        // Open the app/website in a new tab
        window.open(url, '_blank');
        return { success: true, extra: ` Opening ${appName} in a new tab.` };
    }

    toggleTheme(theme) {
        if (theme === 'dark' || document.body.style.background === 'rgb(30, 30, 30)') {
            document.body.style.background = '#f4f6f8';
            document.body.style.color = '#333';
            return { success: { theme: 'light' } };
        } else {
            document.body.style.background = '#1e1e1e';
            document.body.style.color = '#f4f6f8';
            return { success: { theme: 'dark' } };
        }
    }

    clearClipboard() {
        navigator.clipboard.writeText("").catch(() => {});
        return { success: true };
    }
}