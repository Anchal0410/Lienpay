import { create } from 'zustand'

const useStore = create((set, get) => ({
  // ── AUTH ──────────────────────────────────────
  token:   localStorage.getItem('lp_token') || null,
  user:    JSON.parse(localStorage.getItem('lp_user') || 'null'),

  setAuth: (token, user) => {
    localStorage.setItem('lp_token', token)
    localStorage.setItem('lp_user', JSON.stringify(user))
    set({ token, user })
  },

  clearAuth: () => {
    localStorage.removeItem('lp_token')
    localStorage.removeItem('lp_user')
    set({ token: null, user: null })
  },

  // ── ONBOARDING STEP ───────────────────────────
  // STEPS: AUTH → KYC → PORTFOLIO → PLEDGE → CREDIT → ACTIVE
  onboardingStep: localStorage.getItem('lp_step') || 'AUTH',
  setOnboardingStep: (step) => {
    localStorage.setItem('lp_step', step)
    set({ onboardingStep: step })
  },

  // ── PORTFOLIO ─────────────────────────────────
  portfolio: null,
  setPortfolio: (portfolio) => set({ portfolio }),

  // ── RISK DECISION ─────────────────────────────
  riskDecision: null,
  setRiskDecision: (riskDecision) => set({ riskDecision }),

  // ── CREDIT ACCOUNT ────────────────────────────
  creditAccount: null,
  setCreditAccount: (creditAccount) => set({ creditAccount }),

  // ── LTV HEALTH ────────────────────────────────
  ltvHealth: null,
  setLTVHealth: (ltvHealth) => set({ ltvHealth }),

  // ── TRANSACTIONS ──────────────────────────────
  transactions: [],
  setTransactions: (transactions) => set({ transactions }),

  // ── STATEMENTS ────────────────────────────────
  statements: [],
  setStatements: (statements) => set({ statements }),

  // ── UI STATE ──────────────────────────────────
  activeTab: 'home',
  setActiveTab: (activeTab) => set({ activeTab }),
}))

export default useStore
