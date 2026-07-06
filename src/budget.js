/**
 * TokenVault — Budget Alerts
 * 
 * Set spending limits and get warned when approaching them.
 * Supports daily, weekly, and monthly budgets.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const DATA_DIR = path.join(os.homedir(), '.hermes', 'tokenvault');
const BUDGET_FILE = path.join(DATA_DIR, 'budget.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

let budget = {
  daily: null,      // $ per day
  weekly: null,     // $ per week
  monthly: null,    // $ per month
  perSession: null, // $ per session
  alertThreshold: 0.8, // warn at 80%
};

function loadBudget() {
  try {
    if (fs.existsSync(BUDGET_FILE)) {
      budget = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
    }
  } catch { /* fresh */ }
  return budget;
}

function saveBudget() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(budget, null, 2));
}

function loadUsage() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
  } catch {
    return { daily: {}, totals: { cost: 0, saved: 0 } };
  }
}

/**
 * Set budget limits
 */
export function setBudget(opts) {
  loadBudget();
  if (opts.daily !== undefined) budget.daily = opts.daily;
  if (opts.weekly !== undefined) budget.weekly = opts.weekly;
  if (opts.monthly !== undefined) budget.monthly = opts.monthly;
  if (opts.perSession !== undefined) budget.perSession = opts.perSession;
  if (opts.alertThreshold !== undefined) budget.alertThreshold = opts.alertThreshold;
  saveBudget();
  return budget;
}

/**
 * Get current budget config
 */
export function getBudget() {
  loadBudget();
  return { ...budget };
}

/**
 * Check current spending against budgets
 * Returns alerts array
 */
export function checkBudget() {
  loadBudget();
  const usage = loadUsage();
  const alerts = [];
  
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  // Daily check
  if (budget.daily) {
    const todayUsage = usage.daily[today] || { cost: 0 };
    const pct = todayUsage.cost / budget.daily;
    if (pct >= 1) {
      alerts.push({ level: 'critical', type: 'daily', message: `Daily budget EXCEEDED: $${todayUsage.cost.toFixed(2)} / $${budget.daily.toFixed(2)}`, spent: todayUsage.cost, limit: budget.daily });
    } else if (pct >= budget.alertThreshold) {
      alerts.push({ level: 'warning', type: 'daily', message: `Daily budget at ${(pct * 100).toFixed(0)}%: $${todayUsage.cost.toFixed(2)} / $${budget.daily.toFixed(2)}`, spent: todayUsage.cost, limit: budget.daily });
    }
  }
  
  // Weekly check
  if (budget.weekly) {
    let weekCost = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      weekCost += (usage.daily[key] || { cost: 0 }).cost;
    }
    const pct = weekCost / budget.weekly;
    if (pct >= 1) {
      alerts.push({ level: 'critical', type: 'weekly', message: `Weekly budget EXCEEDED: $${weekCost.toFixed(2)} / $${budget.weekly.toFixed(2)}`, spent: weekCost, limit: budget.weekly });
    } else if (pct >= budget.alertThreshold) {
      alerts.push({ level: 'warning', type: 'weekly', message: `Weekly budget at ${(pct * 100).toFixed(0)}%: $${weekCost.toFixed(2)} / $${budget.weekly.toFixed(2)}`, spent: weekCost, limit: budget.weekly });
    }
  }
  
  // Monthly check
  if (budget.monthly) {
    let monthCost = 0;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    for (const [date, data] of Object.entries(usage.daily)) {
      if (new Date(date) >= monthStart) monthCost += data.cost;
    }
    const pct = monthCost / budget.monthly;
    if (pct >= 1) {
      alerts.push({ level: 'critical', type: 'monthly', message: `Monthly budget EXCEEDED: $${monthCost.toFixed(2)} / $${budget.monthly.toFixed(2)}`, spent: monthCost, limit: budget.monthly });
    } else if (pct >= budget.alertThreshold) {
      alerts.push({ level: 'warning', type: 'monthly', message: `Monthly budget at ${(pct * 100).toFixed(0)}%: $${monthCost.toFixed(2)} / $${budget.monthly.toFixed(2)}`, spent: monthCost, limit: budget.monthly });
    }
  }
  
  return alerts;
}

/**
 * Get budget status summary
 */
export function getStatus() {
  loadBudget();
  const usage = loadUsage();
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  const status = {
    daily: budget.daily ? { limit: budget.daily, spent: (usage.daily[today] || { cost: 0 }).cost, remaining: budget.daily - (usage.daily[today] || { cost: 0 }).cost } : null,
    total: { spent: usage.totals.cost || 0, saved: usage.totals.saved || 0 },
    alerts: checkBudget(),
  };
  
  return status;
}

export default {
  setBudget,
  getBudget,
  checkBudget,
  getStatus,
};
