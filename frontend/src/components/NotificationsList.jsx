import React, { useState } from 'react';
import { Bell, Search, RefreshCw, CheckCircle2, MessageSquare, Tag, AlertCircle } from 'lucide-react';

export default function NotificationsList({ notifications, loading, error, serviceHealth, onRefresh }) {
  const [searchTerm, setSearchTerm] = useState('');

  const isFaulted = serviceHealth?.fault && serviceHealth.fault !== 'NONE';
  const faultType = serviceHealth?.fault;

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
            <span>Notification Microservice (/notifications) &bull; Port :8086</span>
          </div>
          <h2 className="text-xl font-bold text-white">System Notification Center</h2>
          <p className="text-slate-400 text-xs">
            Live notification events dispatched by Notification Service during order, payment, and shipping workflows.
          </p>
        </div>

        <button
          onClick={onRefresh}
          className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition self-start sm:self-center"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh List</span>
        </button>
      </div>

      {/* Outage / Fault Notice */}
      {(error || isFaulted) && (
        <div className="p-5 rounded-2xl bg-rose-950/80 border border-rose-800/80 text-rose-200 text-xs space-y-2 shadow-lg animate-in fade-in duration-200">
          <div className="flex items-center space-x-2 font-bold text-sm text-rose-300">
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
            <span>Notification Microservice Outage Detected</span>
            {faultType && (
              <span className="px-2 py-0.5 rounded bg-rose-900 border border-rose-700 text-[10px] font-extrabold uppercase">
                {faultType}
              </span>
            )}
          </div>
          <p className="text-slate-300">
            {error || `Notification Service (:8086) is experiencing a ${faultType} fault. Customer alerts and operational notifications cannot be dispatched.`}
          </p>
        </div>
      )}

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

      {/* Notification Stream Cards */}
      <div className="space-y-3">
        {loading && (
          <div className="py-8 text-center text-slate-500 text-xs font-sans">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
            <span>Fetching system notifications...</span>
          </div>
        )}

        {!loading && filteredNotifications.map((notif) => (
          <div 
            key={notif.id} 
            className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80 hover:border-slate-700 transition flex items-start space-x-4"
          >
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 flex-shrink-0">
              <MessageSquare className="w-4 h-4" />
            </div>

            <div className="flex-1 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-white font-mono">Notif-#{notif.id}</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300">
                    <Tag className="w-2.5 h-2.5 mr-1" />
                    {notif.type || 'NOTIFICATION'}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 font-sans">
                  {notif.timestamp ? new Date(notif.timestamp).toLocaleTimeString() : 'Just Now'}
                </span>
              </div>

              <p className="text-xs text-slate-300 font-sans leading-relaxed">
                {notif.message}
              </p>

              <div className="text-[10px] text-indigo-400 font-mono">
                Recipient: User-{notif.userId || 101} &bull; Delivery: {notif.status || 'SENT'}
              </div>
            </div>
          </div>
        ))}

        {!loading && filteredNotifications.length === 0 && (
          <div className="py-10 text-center text-slate-500 text-xs font-sans">
            {isFaulted || error ? (
              <div className="space-y-1">
                <p className="text-rose-300 font-semibold">Notification logs unavailable</p>
                <p className="text-xs text-slate-500">Service is down or unreachable. Notifications will appear once notification-service recovers.</p>
              </div>
            ) : (
              <span>No notifications found.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
