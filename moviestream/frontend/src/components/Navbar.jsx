import React, { useState, useRef, useEffect } from 'react'
import {
  Play, Search, Bell, User, Heart, Clock,
  Sparkles, ExternalLink, Activity, CheckCircle2,
  AlertTriangle, ChevronDown, Store, Sliders,
  Globe, Film, Tv, Flame, X, RefreshCw
} from 'lucide-react'

export default function Navbar({
  activeProfile,
  profiles,
  onSelectProfile,
  searchQuery,
  setSearchQuery,
  healthStatuses,
  onOpenRadar,
  activeTab,
  onSelectTab,
  onSelectLanguage,
  syncStatus,
  onTriggerSync,
  isSyncing
}) {
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)
  const [langDropdownOpen, setLangDropdownOpen] = useState(false)
  const [syncDropdownOpen, setSyncDropdownOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const searchInputRef = useRef(null)

  // Track window scroll for Netflix navbar dark fade effect
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 40)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [searchOpen])

  const healthyCount = healthStatuses.filter(s => s.healthy).length
  const allHealthy = healthyCount === healthStatuses.length && healthStatuses.length > 0
  const hasIssues = !allHealthy && healthStatuses.length > 0

  const navLinks = [
    { id: 'home', label: 'Home' },
    { id: 'tv', label: 'TV Shows' },
    { id: 'movies', label: 'Movies' },
    { id: 'latest', label: 'New & Popular' },
    { id: 'mylist', label: 'My List' }
  ]

  const languages = [
    { code: 'kn', name: 'Kannada (Sandalwood)', count: '4 Titles' },
    { code: 'te', name: 'Telugu (Tollywood)', count: '5 Titles' },
    { code: 'hi', name: 'Hindi (Bollywood)', count: '6 Titles' },
    { code: 'en', name: 'English (Hollywood)', count: '14 Titles' }
  ]

  return (
    <nav 
      className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-500 ${
        scrolled ? 'bg-[#141414]/95 shadow-2xl backdrop-blur-md border-b border-white/5' : 'bg-gradient-to-b from-black/80 via-black/40 to-transparent'
      }`}
    >
      <div className="max-w-[1920px] mx-auto px-4 sm:px-8 lg:px-12 h-16 sm:h-20 flex items-center justify-between">
        
        {/* Left: Netflix Logo & Main Nav Tabs */}
        <div className="flex items-center gap-6 sm:gap-10">
          
          {/* Authentic Netflix Wordmark */}
          <div 
            onClick={() => onSelectTab('home')}
            className="flex items-center gap-2 cursor-pointer select-none group"
            title="Netflix Home"
          >
            <span className="text-2xl sm:text-3xl font-black tracking-tight text-[#E50914] uppercase drop-shadow-[0_2px_8px_rgba(229,9,20,0.4)] group-hover:scale-105 transition-transform">
              NETFLIX
            </span>
            <span className="hidden xl:inline-block px-1.5 py-0.5 text-[9px] font-bold tracking-widest uppercase bg-zinc-800 text-zinc-300 rounded border border-zinc-700">
              MovieStream Engine
            </span>
          </div>

          {/* Primary Navigation Links */}
          <div className="hidden md:flex items-center gap-4 lg:gap-6 text-xs lg:text-sm font-medium text-zinc-300">
            {navLinks.map(link => (
              <button
                key={link.id}
                onClick={() => onSelectTab(link.id)}
                className={`transition-colors hover:text-white ${
                  activeTab === link.id ? 'text-white font-bold' : 'text-zinc-300/80'
                }`}
              >
                {link.label}
              </button>
            ))}

            {/* Browse by Languages Dropdown */}
            <div className="relative">
              <button
                onClick={() => setLangDropdownOpen(!langDropdownOpen)}
                className="flex items-center gap-1.5 text-zinc-300/80 hover:text-white transition-colors"
              >
                <Globe className="w-3.5 h-3.5 text-zinc-400" />
                <span className="hidden lg:inline">Languages</span>
                <ChevronDown className="w-3 h-3 text-zinc-400" />
              </button>

              {langDropdownOpen && (
                <div 
                  className="absolute left-0 mt-3 w-56 rounded-lg bg-[#181818] border border-zinc-700/80 shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                  onMouseLeave={() => setLangDropdownOpen(false)}
                >
                  <p className="text-[10px] uppercase font-bold text-zinc-400 px-3 py-1.5 tracking-wider border-b border-zinc-800">
                    Browse by Original Language
                  </p>
                  {languages.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        onSelectLanguage(lang.code)
                        setLangDropdownOpen(false)
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs text-left rounded-md text-zinc-200 hover:bg-zinc-800 hover:text-white transition-colors"
                    >
                      <span className="font-medium">{lang.name}</span>
                      <span className="text-[10px] text-zinc-400">{lang.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Right Section: Search, Telemetry Radar, Notifications, Ecosystem Links, Profile */}
        <div className="flex items-center gap-3 sm:gap-5">
          
          {/* Netflix Expandable Search Bar */}
          <div className="relative flex items-center">
            {searchOpen ? (
              <div className="flex items-center bg-black/90 border border-white/80 rounded px-2.5 py-1.5 w-52 sm:w-72 transition-all">
                <Search className="w-4 h-4 text-zinc-300 mr-2 flex-shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Titles, people, Kannada, Telugu, genres..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="bg-transparent text-xs text-white placeholder-zinc-400 focus:outline-none w-full"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="text-zinc-400 hover:text-white text-sm ml-1"
                  >
                    ×
                  </button>
                )}
                <button 
                  onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                  className="text-zinc-400 hover:text-white text-xs ml-1.5 pl-1.5 border-l border-zinc-700"
                >
                  Close
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
                className="p-1.5 text-zinc-300 hover:text-white transition-colors"
                title="Search Netflix"
              >
                <Search className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Real-Time Live API Auto-Sync Indicator & Controls */}
          <div className="relative">
            <button
              onClick={() => setSyncDropdownOpen(!syncDropdownOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border border-emerald-500/40 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/60 transition-all shadow-[0_0_12px_rgba(16,185,129,0.18)]"
              title="Continuous Live Data Collection from Real-World APIs"
            >
              <span className={`w-2 h-2 rounded-full bg-emerald-400 ${isSyncing ? 'animate-spin' : 'animate-pulse'}`} />
              <span className="hidden sm:inline font-mono">LIVE API</span>
              <span className="px-1.5 py-0.2 rounded bg-emerald-900/80 text-[10px] text-emerald-200 font-mono font-bold">
                {syncStatus?.totalLiveTitles ? `${syncStatus.totalLiveTitles} Titles` : 'Auto-Sync'}
              </span>
            </button>

            {syncDropdownOpen && (
              <div
                className="absolute right-0 mt-3 w-80 rounded-xl bg-[#181818] border border-emerald-500/30 shadow-2xl p-3.5 z-50 text-xs animate-in fade-in slide-in-from-top-2 duration-150 backdrop-blur-md"
                onMouseLeave={() => setSyncDropdownOpen(false)}
              >
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="font-bold text-white">Live API Auto-Collection</span>
                  </div>
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 border border-emerald-500/40">
                    AUTOMATIC
                  </span>
                </div>

                <div className="py-2.5 space-y-2 text-zinc-300">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-zinc-400">Total Live Ingested Titles:</span>
                    <span className="font-bold text-emerald-400 font-mono">{syncStatus?.totalLiveTitles || 370}+ Titles</span>
                  </div>
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-zinc-400">Sync Polling Interval:</span>
                    <span className="text-zinc-200 font-mono">Every 10 minutes</span>
                  </div>
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-zinc-400">Active Live Sources:</span>
                    <span className="text-zinc-200 font-medium">Cinemeta (TMDB/IMDb) & TVMaze</span>
                  </div>
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-zinc-400">On-The-Fly Search:</span>
                    <span className="text-emerald-400 font-medium">Live Queries Real APIs</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-zinc-800">
                  <button
                    onClick={() => {
                      if (onTriggerSync) onTriggerSync()
                    }}
                    disabled={isSyncing}
                    className="w-full py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-950"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    <span>{isSyncing ? 'Harvesting Live API Data...' : 'Sync Live Data Now'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Microservice Observability Radar Button */}
          <button
            onClick={onOpenRadar}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              hasIssues 
                ? 'bg-amber-950/60 border-amber-500/70 text-amber-300 hover:bg-amber-900/60' 
                : 'bg-zinc-900/80 border-zinc-700/80 text-zinc-300 hover:bg-zinc-800'
            }`}
            title="Inspect MovieStream 5 Microservice Health Radar"
          >
            <Activity className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Telemetry</span>
            <span className={`w-2 h-2 rounded-full ${hasIssues ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
          </button>

          {/* Cross-Application Links to OmniStore, Dashboard, Fault Lab */}
          <div className="hidden xl:flex items-center gap-1 pl-2 border-l border-zinc-800 text-xs">
            <a
              href="http://localhost:3000"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Switch to OmniStore E-Commerce (:3000)"
            >
              <Store className="w-3 h-3 text-blue-400" />
              <span>OmniStore</span>
            </a>

            <a
              href="http://localhost:4000"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Open Developer Observability Dashboard (:4000)"
            >
              <Activity className="w-3 h-3 text-purple-400" />
              <span>Dashboard</span>
            </a>

            <a
              href="http://localhost:4001"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              title="Open Fault Injection Lab (:4001)"
            >
              <Sliders className="w-3 h-3 text-amber-400" />
              <span>Fault Lab</span>
            </a>
          </div>

          {/* Notifications Bell */}
          <div className="relative">
            <button
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className="p-1.5 text-zinc-300 hover:text-white relative transition-colors"
              title="Notifications"
            >
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#E50914]" />
            </button>

            {notificationsOpen && (
              <div 
                className="absolute right-0 mt-3 w-80 rounded-lg bg-[#181818] border border-zinc-700/80 shadow-2xl p-3 z-50 text-xs animate-in fade-in slide-in-from-top-2 duration-150"
                onMouseLeave={() => setNotificationsOpen(false)}
              >
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800 font-bold text-white">
                  <span>Notifications</span>
                  <span className="text-[10px] text-zinc-400 font-normal">Real-Time Trace</span>
                </div>
                <div className="divide-y divide-zinc-800/80">
                  <div className="py-2.5 flex items-start gap-2.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-zinc-200">Catalog Service Live</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5">Kannada & Telugu regional titles indexed with TMDB CDN.</p>
                    </div>
                  </div>
                  <div className="py-2.5 flex items-start gap-2.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 mt-1 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-zinc-200">Recommendation Engine Active</p>
                      <p className="text-[11px] text-zinc-400 mt-0.5">Collaborative filtering synchronized with History (:8092).</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Netflix Profile Avatar & Switcher Dropdown */}
          <div className="relative">
            <button
              onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
              className="flex items-center gap-1.5 p-1 rounded hover:opacity-90 transition-opacity"
            >
              <img
                src={activeProfile?.avatarUrl || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80"}
                alt={activeProfile?.displayName || "Profile"}
                className="w-8 h-8 rounded object-cover border-2 border-transparent hover:border-white transition-all"
              />
              <ChevronDown className="w-3.5 h-3.5 text-zinc-300 hidden sm:block" />
            </button>

            {profileDropdownOpen && (
              <div 
                className="absolute right-0 mt-3 w-64 rounded-md bg-[#181818] border border-zinc-700/80 shadow-2xl p-2 z-50 text-xs animate-in fade-in slide-in-from-top-2 duration-150"
                onMouseLeave={() => setProfileDropdownOpen(false)}
              >
                {/* Active Profile Info */}
                <div className="px-3 py-2 border-b border-zinc-800 mb-1">
                  <p className="font-bold text-white text-sm">{activeProfile?.displayName || 'Alice Reynolds'}</p>
                  <p className="text-[11px] text-emerald-400 font-semibold">{activeProfile?.plan || 'Ultra HD 4K + HDR'}</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5 font-mono">{activeProfile?.email || 'alice@moviestream.io'}</p>
                </div>

                {/* Switch Profile List */}
                <div className="py-1">
                  <p className="text-[10px] uppercase font-bold text-zinc-400 px-3 py-1 tracking-wider">
                    Switch Profile
                  </p>
                  {profiles.map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onSelectProfile(p.id)
                        setProfileDropdownOpen(false)
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded text-left transition-colors ${
                        p.id === activeProfile?.id 
                          ? 'bg-[#E50914]/20 text-white font-semibold' 
                          : 'text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <img src={p.avatarUrl} alt={p.displayName} className="w-6 h-6 rounded object-cover" />
                        <span>{p.displayName}</span>
                      </div>
                      {p.id === activeProfile?.id && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#E50914]" />
                      )}
                    </button>
                  ))}
                </div>

                {/* Netflix Standard Account Links */}
                <div className="pt-2 border-t border-zinc-800 space-y-1">
                  <button 
                    onClick={() => { onSelectTab('mylist'); setProfileDropdownOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded"
                  >
                    My Watchlist
                  </button>
                  <button 
                    onClick={() => onOpenRadar()}
                    className="w-full text-left px-3 py-1.5 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded flex items-center justify-between"
                  >
                    <span>Architecture Radar</span>
                    <span className="text-[10px] text-cyan-400">5 Services</span>
                  </button>
                  <a 
                    href="https://help.netflix.com" 
                    target="_blank" 
                    rel="noreferrer" 
                    className="block px-3 py-1.5 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded"
                  >
                    Help Centre
                  </a>
                </div>

                <div className="pt-2 mt-1 border-t border-zinc-800">
                  <button 
                    onClick={() => {
                      if (profiles.length > 0) onSelectProfile(profiles[0].id)
                      setProfileDropdownOpen(false)
                    }}
                    className="w-full text-center py-1.5 text-zinc-400 hover:text-white font-medium hover:bg-zinc-800 rounded"
                  >
                    Reset & Sign Out of Netflix
                  </button>
                </div>

              </div>
            )}
          </div>

        </div>

      </div>
    </nav>
  )
}
