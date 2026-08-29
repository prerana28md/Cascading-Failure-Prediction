import React, { useState } from 'react';
import { Bell, Search, RefreshCw, CheckCircle2, MessageSquare, Tag, AlertCircle } from 'lucide-react';

export default function NotificationsList({ notifications, loading, error, onRefresh }) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredNotifications = (notifications || []).filter(n => 
    String(n.id || '').includes(searchTerm) ||
    String(n.userId || '').includes(searchTerm) ||
    (n.type || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (n.message || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 p-6 rounded-2xl border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold">
            <Bell className="w-4 h-4" />
            <span>Notification Microservice (/notifications)</span>
          </div>
          <h2 className="text-xl font-bold text-white">System Notification Center</h2>
          <p className="text-slate-400 text-xs">
            Live notification events dispatched by Notification Service during order, payment, and shipping workflows.
          </p>
        </div>

        <button
          onClick={onRefresh}
          className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh List</span>
        </button>
      </div>

      {/* Filter */}
      <div className="relative w-full sm:w-80">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Search notifications, types, user IDs..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-3">
          <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <span>Notice: {error}. Showing mock notification log.</span>
        </div>
      )}

      {/* Notification Stream Cards */}
      <div className="space-y-3">
        {loading && (
          <div className="py-8 text-center text-slate-500 text-xs">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
            <span>Fetching system notifications...</span>
          </div>
        )}

        {!loading && filteredNotifications.map((n) => {
          const typeUpper = (n.type || 'NOTIFICATION').toUpperCase();
          return (
            <div
              key={n.id}
              className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex items-start justify-between gap-4 hover:border-slate-700 transition"
            >
              <div className="flex items-start space-x-3">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 mt-0.5">
                  <MessageSquare className="w-4 h-4" />
                </div>
                
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-white">Notif #{n.id}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-slate-800 text-indigo-300 border border-slate-700">
                      <Tag className="w-2.5 h-2.5 mr-1" />
                      {typeUpper}
                    </span>
                    <span className="text-[11px] text-slate-400">User-{n.userId || 1}</span>
                  </div>

                  <p className="text-xs text-slate-200 font-sans">
                    {n.message}
                  </p>
                </div>
              </div>

              <div className="text-right flex flex-col items-end space-y-1">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {n.status || 'SENT'}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {n.timestamp ? new Date(n.timestamp).toLocaleTimeString() : 'Just Now'}
                </span>
              </div>
            </div>
          );
        })}

        {!loading && filteredNotifications.length === 0 && (
          <div className="py-12 text-center text-slate-500 text-xs bg-slate-900/60 rounded-xl border border-slate-800">
            No notification messages found.
          </div>
        )}
      </div>
    </div>
  );
}
