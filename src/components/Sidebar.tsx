'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarProps {
  activeItem?: 'dashboard' | 'queue' | 'consult' | 'appointments' | 'followups' | 'patients' | 'billing' | 'reports' | 'settings';
}

export function Sidebar({ activeItem }: SidebarProps) {
  const pathname = usePathname();

  const getActive = (item: string) => {
    if (activeItem) return activeItem === item;
    if (item === 'dashboard' && pathname === '/') return true;
    if (item === 'patients' && pathname.startsWith('/patients')) return true;
    if (item === 'appointments' && pathname.startsWith('/appointments')) return true;
    if (item === 'followups' && pathname.startsWith('/followups')) return true;
    if (item === 'queue' && pathname.startsWith('/queue')) return true;
    if (item === 'billing' && pathname.startsWith('/billing')) return true;
    if (item === 'reports' && pathname.startsWith('/reports')) return true;
    return false;
  };

  const navClasses = (isActive: boolean) =>
    `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
      isActive
        ? 'bg-blue-600 text-white shadow-sm'
        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800/60'
    }`;

  return (
    <aside
      id="main-sidebar"
      aria-label="Main Navigation"
      className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between shrink-0 min-h-screen select-none"
    >
      <div className="p-4 space-y-6">
        {/* Brand header */}
        <div className="flex items-center gap-2.5 px-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
            +
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-lg tracking-tight text-slate-900 dark:text-white">
              Sure<span className="text-blue-600">+</span>
            </span>
            <span className="text-[10px] text-slate-500 font-mono tracking-wider uppercase">
              Clinical OS
            </span>
          </div>
        </div>

        {/* Clinic badge */}
        <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-xs shrink-0">
            DS
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
              Dr. Susheel&apos;s Clinic
            </p>
            <p className="text-[10px] text-slate-500 truncate">Advanced Dental Practice</p>
          </div>
        </div>

        {/* Navigation Sections */}
        <nav className="space-y-4">
          <div>
            <p className="px-3 text-[10px] font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-1">
              Main
            </p>
            <div className="space-y-0.5">
              <Link
                id="sidebar-dashboard"
                href="/"
                className={navClasses(getActive('dashboard'))}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <span>Dashboard</span>
              </Link>

              <Link
                id="sidebar-queue"
                href="/queue"
                className={navClasses(getActive('queue'))}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Live Queue</span>
              </Link>
            </div>
          </div>

          <div>
            <p className="px-3 text-[10px] font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-1">
              Clinical
            </p>
            <div className="space-y-0.5">
              <Link
                id="sidebar-appointments"
                href="/appointments"
                className={navClasses(getActive('appointments'))}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>Appointments</span>
              </Link>

              <Link
                id="sidebar-followups"
                href="/followups"
                className={navClasses(getActive('followups'))}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <span>Follow-ups</span>
              </Link>

              <Link
                id="sidebar-patients"
                href="/patients"
                className={navClasses(getActive('patients'))}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span>Patients</span>
              </Link>
            </div>
          </div>

          <div>
            <p className="px-3 text-[10px] font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-1">
              Financial
            </p>
            <div className="space-y-0.5">
              <Link
                id="sidebar-billing"
                href="/billing"
                className={navClasses(getActive('billing'))}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z" />
                </svg>
                <span>Billing & Estimates</span>
              </Link>
            </div>
          </div>

          <div>
            <p className="px-3 text-[10px] font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-1">
              Practice
            </p>
            <div className="space-y-0.5">
              <Link
                id="sidebar-reports"
                href="/reports/closing"
                className={navClasses(getActive('reports'))}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span>Closing Reports</span>
              </Link>

              <Link
                id="sidebar-kiosk"
                href="/register"
                target="_blank"
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800/60"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <span>Kiosk Mode</span>
              </Link>
            </div>
          </div>
        </nav>
      </div>

      {/* User profile footer */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center font-bold text-xs text-slate-700 dark:text-slate-300">
            DR
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
              Dr. Susheel
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-400 truncate">Doctor Session</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
