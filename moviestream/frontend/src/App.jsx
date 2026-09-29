import React, { useState, useEffect, useCallback, Component } from 'react'
import {
  Sparkles, Clock, Heart, Flame, Star, Film,
  AlertTriangle, RefreshCw, Layers, ExternalLink,
  Tv, Trophy, Plus, Play, Info
} from 'lucide-react'
import Navbar from './components/Navbar'
import Billboard from './components/Billboard'
import MovieRow from './components/MovieRow'
import MovieModal from './components/MovieModal'
import VideoPlayerModal from './components/VideoPlayerModal'
import HealthRadarModal from './components/HealthRadarModal'
import {
  fetchBillboard,
  fetchTrending,
  fetchTopRated,
  fetchIndianCinema,
  fetchTVShows,
  fetchMovies,
  fetchTop10,
  fetchOriginals,
  fetchGenreMovies,
  fetchRecommendations,
  fetchContinueWatching,
  fetchWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  fetchProfiles,
  checkMicroservicesHealth,
  searchMovies,
  fetchLiveSyncStatus,
  triggerLiveSync
} from './services/api'

// Fallback seed catalog to ensure ZERO blank screen on refresh
const SEED_BILLBOARD = {
  id: 1083637,
  title: "Kantara",
  tagline: "A Legend Becoming Reality",
  overview: "When greed paves the way for betrayal and scheming, a young tribal man reluctantly embraces his ancestors' divine traditions (Daivaradhane / Bhoota Kola) to seek justice for his community in coastal Karnataka.",
  release_date: "2022-09-30",
  vote_average: 8.3,
  vote_count: 410,
  runtime: 148,
  poster_path: "/w57nxiBIODAYHLRs1xmrCY9zEFe.jpg",
  backdrop_path: "/w57nxiBIODAYHLRs1xmrCY9zEFe.jpg",
  genres: [{ id: 28, name: "Action" }, { id: 18, name: "Drama" }, { id: 53, name: "Thriller" }],
  media_type: "movie",
  original_language: "kn",
  region: "Kannada Sandalwood",
  director: "Rishab Shetty",
  cast: ["Rishab Shetty", "Sapthami Gowda", "Kishore", "Achyuth Kumar"],
  trailer_key: "M2OnifMgvps"
}

// Resilient Error Boundary to prevent page crashes
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, errorInfo) {
    console.error("MovieStream ErrorBoundary caught error:", error, errorInfo)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#141414] text-white flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-[#E50914]/20 border border-[#E50914] flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-[#E50914]" />
          </div>
          <h1 className="text-2xl font-black mb-2">Something went wrong</h1>
          <p className="text-zinc-400 text-sm max-w-md mb-4">
            The Netflix client encountered an unexpected state. You can reload to restore the streaming session.
          </p>

          {this.state.error && (
            <div className="bg-black/60 border border-zinc-800 rounded p-3 mb-6 max-w-lg text-left font-mono text-xs text-red-400 overflow-x-auto">
              <p className="font-bold">{this.state.error.message || this.state.error.toString()}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
              }}
              className="px-5 py-2.5 rounded bg-zinc-800 text-white font-bold hover:bg-zinc-700 transition-colors border border-zinc-700 text-sm"
            >
              Try Again
            </button>
            <button
              onClick={() => {
                localStorage.clear()
                window.location.reload()
              }}
              className="px-6 py-2.5 rounded bg-[#E50914] text-white font-bold hover:bg-[#b80710] transition-colors text-sm"
            >
              Reload Netflix Client
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <MovieStreamMain />
    </ErrorBoundary>
  )
}

function MovieStreamMain() {
  // Navigation Tab: 'home' | 'tv' | 'movies' | 'latest' | 'mylist'
  const [activeTab, setActiveTab] = useState('home')

  // User Profile with localStorage persistence
  const [profiles, setProfiles] = useState([])
  const [activeProfile, setActiveProfile] = useState(() => {
    try {
      const saved = localStorage.getItem('netflix_active_user')
      return saved ? JSON.parse(saved) : null
    } catch (_) {
      return null
    }
  })

  // Catalog Content State
  const [billboard, setBillboard] = useState(SEED_BILLBOARD)
  const [top10, setTop10] = useState([])
  const [trending, setTrending] = useState([])
  const [indianCinema, setIndianCinema] = useState([])
  const [originals, setOriginals] = useState([])
  const [tvShows, setTvShows] = useState([])
  const [allMovies, setAllMovies] = useState([])
  const [topRated, setTopRated] = useState([])
  const [scifi, setScifi] = useState([])
  const [action, setAction] = useState([])

  // User History & Recommendation Data State
  const [recommendations, setRecommendations] = useState(null)
  const [continueWatching, setContinueWatching] = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [watchlistIds, setWatchlistIds] = useState(new Set())

  // Search State
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)

  // Modals
  const [selectedMovie, setSelectedMovie] = useState(null)
  const [playingMovie, setPlayingMovie] = useState(null)
  const [radarOpen, setRadarOpen] = useState(false)

  // Health Radar & Live API Sync
  const [healthStatuses, setHealthStatuses] = useState([])
  const [refreshingRadar, setRefreshingRadar] = useState(false)
  const [cascadeAlert, setCascadeAlert] = useState(null)
  const [syncStatus, setSyncStatus] = useState(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncBanner, setSyncBanner] = useState(null)

  // Catalog loader function
  const loadCatalogData = useCallback(() => {
    fetchBillboard().then(res => {
      if (res.data) setBillboard(res.data)
    })
    fetchTop10().then(res => {
      if (res.data) setTop10(res.data)
    })
    fetchTrending().then(res => {
      if (res.data) setTrending(res.data)
    })
    fetchIndianCinema().then(res => {
      if (res.data) setIndianCinema(res.data)
    })
    fetchOriginals().then(res => {
      if (res.data) setOriginals(res.data)
    })
    fetchTVShows().then(res => {
      if (res.data) setTvShows(res.data)
    })
    fetchMovies().then(res => {
      if (res.data) setAllMovies(res.data)
    })
    fetchTopRated().then(res => {
      if (res.data) setTopRated(res.data)
    })
    fetchGenreMovies(878).then(res => {
      if (res.data) setScifi(res.data)
    })
    fetchGenreMovies(28).then(res => {
      if (res.data) setAction(res.data)
    })
  }, [])

  // Poll Live Sync Status
  const pollSyncStatus = useCallback(() => {
    fetchLiveSyncStatus().then(res => {
      if (res.data) setSyncStatus(res.data)
    })
  }, [])

  // Manual Trigger for Live API Sync
  const handleTriggerSync = async () => {
    setIsSyncing(true)
    try {
      const res = await triggerLiveSync()
      if (res.data) {
        setSyncStatus(prev => ({
          ...(prev || {}),
          totalLiveTitles: res.data.totalCatalogTitles,
          lastSyncedAt: res.data.lastSyncedAt,
          syncCount: res.data.syncCount
        }))
        setSyncBanner(`✨ Live API Auto-Sync: Harvested ${res.data.newTitlesAdded} new live titles in ${res.data.durationSeconds}s! Total live titles: ${res.data.totalCatalogTitles}`)
        setTimeout(() => setSyncBanner(null), 8000)
        // Refresh catalog rows
        loadCatalogData()
      }
    } catch (e) {
      console.error("Failed to trigger live sync:", e)
    } finally {
      setIsSyncing(false)
    }
  }

  // 1. Initial Load: Profiles, Catalog & Live Sync Status
  useEffect(() => {
    fetchProfiles().then(res => {
      if (res.data && res.data.length > 0) {
        setProfiles(res.data)
        if (!activeProfile) {
          setActiveProfile(res.data[0])
          localStorage.setItem('netflix_active_user', JSON.stringify(res.data[0]))
        }
      }
    })

    loadCatalogData()
    pollSyncStatus()

    const syncInterval = setInterval(pollSyncStatus, 15000)
    return () => clearInterval(syncInterval)
  }, [loadCatalogData, pollSyncStatus])

  // 2. Load User Rows whenever activeProfile changes
  const loadUserRows = useCallback((userId) => {
    if (!userId) return

    fetchRecommendations(userId).then(res => {
      if (res.data) {
        setRecommendations(res.data)
        setCascadeAlert(null)
      } else if (res.error) {
        setCascadeAlert(`Recommendation Service Degradation: ${res.error}`)
      }
    })

    fetchContinueWatching(userId).then(res => {
      if (res.data) setContinueWatching(res.data)
    })

    fetchWatchlist(userId).then(res => {
      if (res.data) {
        setWatchlist(res.data)
        setWatchlistIds(new Set(res.data.map(m => m.id)))
      }
    })
  }, [])

  useEffect(() => {
    if (activeProfile?.id) {
      loadUserRows(activeProfile.id)
    }
  }, [activeProfile, loadUserRows])

  // Profile switch handler
  const handleSelectProfile = (userId) => {
    const found = profiles.find(p => p.id === userId)
    if (found) {
      setActiveProfile(found)
      localStorage.setItem('netflix_active_user', JSON.stringify(found))
    }
  }

  // 3. Search Handling
  useEffect(() => {
    if (searchQuery.trim().length > 1) {
      setIsSearching(true)
      const timer = setTimeout(() => {
        searchMovies(searchQuery).then(res => {
          if (res.data) setSearchResults(res.data)
          setIsSearching(false)
        })
      }, 250)
      return () => clearTimeout(timer)
    } else {
      setSearchResults([])
      setIsSearching(false)
    }
  }, [searchQuery])

  // 4. Observability Health Radar Polling
  const pollHealth = useCallback(() => {
    setRefreshingRadar(true)
    checkMicroservicesHealth()
      .then(statuses => setHealthStatuses(statuses))
      .finally(() => setRefreshingRadar(false))
  }, [])

  useEffect(() => {
    pollHealth()
    const interval = setInterval(pollHealth, 10000)
    return () => clearInterval(interval)
  }, [pollHealth])

  // 5. Watchlist Toggle Handler
  const handleToggleWatchlist = async (movie) => {
    if (!activeProfile?.id || !movie?.id) return

    const inList = watchlistIds.has(movie.id)
    if (inList) {
      const res = await removeFromWatchlist(activeProfile.id, movie.id)
      if (res.data) {
        setWatchlist(res.data)
        setWatchlistIds(new Set(res.data.map(m => m.id)))
      }
    } else {
      const res = await addToWatchlist(activeProfile.id, movie)
      if (res.data && res.data.watchlist) {
        setWatchlist(res.data.watchlist)
        setWatchlistIds(new Set(res.data.watchlist.map(m => m.id)))
      }
    }
  }

  // 6. Navigation Tab Selection
  const handleSelectTab = (tabId) => {
    setActiveTab(tabId)
    setSearchQuery('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSelectLanguage = (langCode) => {
    setActiveTab('home')
    if (langCode === 'kn') {
      setSearchQuery('Kannada')
    } else if (langCode === 'te') {
      setSearchQuery('Telugu')
    } else if (langCode === 'hi') {
      setSearchQuery('Hindi')
    } else {
      setSearchQuery('English')
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Helper: Extract recommendation items safely
  const topPicksItems = recommendations?.recommendations || recommendations?.sections?.find(s => s.id === 'top_picks')?.items || []
  const becauseWatchedItems = recommendations?.becauseWatched || recommendations?.sections?.find(s => s.id === 'because_watched')?.items || []
  const lastWatchedTitle = recommendations?.lastWatchedTitle || (continueWatching.length > 0 ? continueWatching[0].title : 'Kantara')

  return (
    <div className="min-h-screen bg-[#141414] text-zinc-100 flex flex-col font-sans select-none">
      
      {/* Top Fixed Netflix Navbar */}
      <Navbar
        activeProfile={activeProfile}
        profiles={profiles}
        onSelectProfile={handleSelectProfile}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        healthStatuses={healthStatuses}
        onOpenRadar={() => setRadarOpen(true)}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onSelectLanguage={handleSelectLanguage}
        syncStatus={syncStatus}
        onTriggerSync={handleTriggerSync}
        isSyncing={isSyncing}
      />

      {/* Live API Synchronization Success Toast */}
      {syncBanner && (
        <div className="fixed top-16 sm:top-20 left-0 right-0 z-40 bg-emerald-600/95 border-b border-emerald-400 px-4 py-2 text-white text-xs flex items-center justify-between backdrop-blur-md shadow-lg animate-in slide-in-from-top duration-200">
          <div className="max-w-7xl mx-auto flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
              <span className="font-semibold">{syncBanner}</span>
            </div>
            <button onClick={() => setSyncBanner(null)} className="text-white hover:text-zinc-200 text-sm ml-4">✕</button>
          </div>
        </div>
      )}

      {/* Upstream Microservice Failure Warning Banner */}
      {cascadeAlert && (
        <div className="fixed top-16 sm:top-20 left-0 right-0 z-40 bg-[#E50914]/90 border-b border-[#E50914] px-4 py-2 text-white text-xs flex items-center justify-between backdrop-blur-md">
          <div className="max-w-7xl mx-auto flex items-center gap-2 w-full">
            <AlertTriangle className="w-4 h-4 text-white flex-shrink-0 animate-bounce" />
            <span>
              <strong>Microservice Alert:</strong> {cascadeAlert}. Upstream dependency degradation in MovieStream cluster.
            </span>
            <button
              onClick={() => setRadarOpen(true)}
              className="ml-auto underline font-bold text-white hover:text-zinc-200"
            >
              Inspect in Telemetry Radar
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 pb-16">
        
        {/* Search Results Mode */}
        {searchQuery.trim().length > 1 ? (
          <div className="pt-24 sm:pt-28 px-4 sm:px-8 lg:px-12 space-y-6">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                Results for <span className="text-[#E50914]">"{searchQuery}"</span>
              </h2>
              <span className="text-xs text-zinc-400">{searchResults.length} titles found</span>
            </div>

            {searchResults.length === 0 ? (
              <div className="p-16 text-center text-zinc-500">
                {isSearching ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="netflix-spinner" />
                    <span>Searching Netflix catalog...</span>
                  </div>
                ) : (
                  <p>Your search for "{searchQuery}" did not have any matches. Explore Kannada, Telugu, or Hollywood titles.</p>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {searchResults.map(movie => (
                  <div
                    key={movie.id}
                    onClick={() => setSelectedMovie(movie)}
                    className="rounded-md bg-zinc-900 border border-zinc-800 hover:border-[#E50914] cursor-pointer group transition-all overflow-hidden"
                  >
                    <div className="aspect-[2/3] bg-black relative">
                      <img
                        src={movie.poster_path ? (movie.poster_path.startsWith('http') ? movie.poster_path : `https://image.tmdb.org/t/p/w500${movie.poster_path}`) : ''}
                        alt={movie.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-semibold text-white truncate">{movie.title}</p>
                      <p className="text-[11px] text-emerald-400 mt-0.5">
                        {Math.round((movie.vote_average || 8.0) * 10 + 12)}% Match
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'mylist' ? (
          /* My List Tab (Netflix Watchlist View) */
          <div className="pt-24 sm:pt-28 px-4 sm:px-8 lg:px-12 space-y-6">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h2 className="text-2xl font-bold text-white">My List</h2>
              <span className="text-xs text-zinc-400">{watchlist.length} titles saved</span>
            </div>

            {watchlist.length === 0 ? (
              <div className="py-20 text-center space-y-4">
                <Heart className="w-12 h-12 text-zinc-600 mx-auto" />
                <h3 className="text-lg font-bold text-zinc-300">You haven't added any titles to your list yet.</h3>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                  Browse Indian blockbusters, Hollywood hits, or Netflix originals on the home page and click the + icon to add them.
                </p>
                <button
                  onClick={() => {
                    if (indianCinema.length > 0) handleToggleWatchlist(indianCinema[0])
                    if (indianCinema.length > 1) handleToggleWatchlist(indianCinema[1])
                  }}
                  className="px-6 py-2.5 rounded bg-[#E50914] text-white font-bold text-xs hover:bg-[#b80710] transition-colors"
                >
                  Add Kantara & RRR to My List
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {watchlist.map(movie => (
                  <div
                    key={movie.id}
                    onClick={() => setSelectedMovie(movie)}
                    className="rounded-md bg-zinc-900 border border-zinc-800 hover:border-[#E50914] cursor-pointer group transition-all overflow-hidden"
                  >
                    <div className="aspect-[2/3] bg-black relative">
                      <img
                        src={movie.poster_path ? (movie.poster_path.startsWith('http') ? movie.poster_path : `https://image.tmdb.org/t/p/w500${movie.poster_path}`) : ''}
                        alt={movie.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                    <div className="p-2 flex items-center justify-between">
                      <p className="text-xs font-semibold text-white truncate max-w-[120px]">{movie.title}</p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleToggleWatchlist(movie)
                        }}
                        className="text-[10px] text-zinc-400 hover:text-white"
                        title="Remove"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'tv' ? (
          /* TV Shows Tab */
          <div className="pt-24 sm:pt-28 px-4 sm:px-8 lg:px-12 space-y-8">
            <div>
              <h1 className="text-3xl font-black text-white">TV Shows</h1>
              <p className="text-xs text-zinc-400 mt-1">Acclaimed multi-season series, anime, and dramas on Netflix</p>
            </div>

            <MovieRow
              id="tv-originals"
              title="🔴 Netflix Original Series"
              items={originals}
              watchlistIds={watchlistIds}
              onPlay={(m) => setPlayingMovie(m)}
              onToggleWatchlist={handleToggleWatchlist}
              onSelectMovie={(m) => setSelectedMovie(m)}
            />

            <MovieRow
              id="tv-all"
              title="📺 All TV Dramas, Sci-Fi & Crime Series"
              items={tvShows}
              watchlistIds={watchlistIds}
              onPlay={(m) => setPlayingMovie(m)}
              onToggleWatchlist={handleToggleWatchlist}
              onSelectMovie={(m) => setSelectedMovie(m)}
            />
          </div>
        ) : activeTab === 'movies' ? (
          /* Movies Tab */
          <div className="pt-24 sm:pt-28 px-4 sm:px-8 lg:px-12 space-y-8">
            <div>
              <h1 className="text-3xl font-black text-white">Blockbuster Movies</h1>
              <p className="text-xs text-zinc-400 mt-1">Theatrical masterworks, regional Indian cinema, and Oscar winners</p>
            </div>

            <MovieRow
              id="movies-top10"
              title="🏆 Top 10 Movies in India Today"
              items={top10.filter(m => m.media_type === 'movie')}
              watchlistIds={watchlistIds}
              isTop10={true}
              onPlay={(m) => setPlayingMovie(m)}
              onToggleWatchlist={handleToggleWatchlist}
              onSelectMovie={(m) => setSelectedMovie(m)}
            />

            <MovieRow
              id="movies-indian"
              title="👑 Blockbusters of Indian Cinema"
              items={indianCinema}
              watchlistIds={watchlistIds}
              badgeText="PAN-INDIA HITS"
              onPlay={(m) => setPlayingMovie(m)}
              onToggleWatchlist={handleToggleWatchlist}
              onSelectMovie={(m) => setSelectedMovie(m)}
            />

            <MovieRow
              id="movies-hollywood"
              title="⭐ Critically Acclaimed Masterpieces"
              items={allMovies.filter(m => (m.vote_average || 0) >= 8.0)}
              watchlistIds={watchlistIds}
              onPlay={(m) => setPlayingMovie(m)}
              onToggleWatchlist={handleToggleWatchlist}
              onSelectMovie={(m) => setSelectedMovie(m)}
            />
          </div>
        ) : activeTab === 'latest' ? (
          /* New & Popular Tab */
          <div className="pt-24 sm:pt-28 px-4 sm:px-8 lg:px-12 space-y-8">
            <div>
              <h1 className="text-3xl font-black text-white">New & Popular</h1>
              <p className="text-xs text-zinc-400 mt-1">Trending titles and top-ranked streams right now</p>
            </div>

            <MovieRow
              id="latest-top10"
              title="🏆 Top 10 in India Today"
              items={top10}
              watchlistIds={watchlistIds}
              isTop10={true}
              onPlay={(m) => setPlayingMovie(m)}
              onToggleWatchlist={handleToggleWatchlist}
              onSelectMovie={(m) => setSelectedMovie(m)}
            />

            <MovieRow
              id="latest-trending"
              title="🔥 Trending Worldwide"
              items={trending}
              watchlistIds={watchlistIds}
              onPlay={(m) => setPlayingMovie(m)}
              onToggleWatchlist={handleToggleWatchlist}
              onSelectMovie={(m) => setSelectedMovie(m)}
            />
          </div>
        ) : (
          /* Standard Full Netflix Home View */
          <>
            {/* Hero Billboard Banner */}
            <Billboard
              movie={billboard}
              inWatchlist={billboard ? watchlistIds.has(billboard.id) : false}
              onPlay={(m) => setPlayingMovie(m)}
              onToggleWatchlist={handleToggleWatchlist}
              onMoreInfo={(m) => setSelectedMovie(m)}
            />

            {/* Netflix Content Shelves */}
            <div className="space-y-4 -mt-10 sm:-mt-20 relative z-20">
              
              {/* 1. Continue Watching (History Service :8092) */}
              {continueWatching.length > 0 && (
                <MovieRow
                  id="continue-watching"
                  title={`▶️ Continue Watching for ${activeProfile?.displayName || 'Alice'}`}
                  items={continueWatching}
                  watchlistIds={watchlistIds}
                  showProgress={true}
                  badgeText="HISTORY SERVICE :8092"
                  onPlay={(m) => setPlayingMovie(m)}
                  onToggleWatchlist={handleToggleWatchlist}
                  onSelectMovie={(m) => setSelectedMovie(m)}
                />
              )}

              {/* 2. Dynamic Watch History Recommendation: Because You Watched {Title} */}
              {becauseWatchedItems.length > 0 && (
                <MovieRow
                  id="because-watched"
                  title={`🍿 Because You Watched ${lastWatchedTitle}`}
                  subtitle={`Dynamically generated by Recommendation Service (:8093) from your recent watch history`}
                  items={becauseWatchedItems}
                  watchlistIds={watchlistIds}
                  badgeText="RECOMMENDATION ENGINE"
                  onPlay={(m) => setPlayingMovie(m)}
                  onToggleWatchlist={handleToggleWatchlist}
                  onSelectMovie={(m) => setSelectedMovie(m)}
                />
              )}

              {/* 3. Top 10 in India Today (Signature Netflix Numbered Row) */}
              {top10.length > 0 && (
                <MovieRow
                  id="top10"
                  title="🏆 Top 10 in India Today"
                  items={top10}
                  watchlistIds={watchlistIds}
                  isTop10={true}
                  onPlay={(m) => setPlayingMovie(m)}
                  onToggleWatchlist={handleToggleWatchlist}
                  onSelectMovie={(m) => setSelectedMovie(m)}
                />
              )}

              {/* 4. Personalized Collaborative Recommendations (Recommendation Service :8093) */}
              {topPicksItems.length > 0 && (
                <MovieRow
                  id="recommended"
                  title={`✨ Top Picks for ${activeProfile?.displayName || 'Alice'}`}
                  subtitle={`Personalized by collaborative filtering from your favorite genres`}
                  items={topPicksItems}
                  watchlistIds={watchlistIds}
                  badgeText="RECOMMENDATION SERVICE :8093"
                  onPlay={(m) => setPlayingMovie(m)}
                  onToggleWatchlist={handleToggleWatchlist}
                  onSelectMovie={(m) => setSelectedMovie(m)}
                />
              )}

              {/* 5. Blockbusters of Indian Cinema (Kannada, Telugu, Hindi seamlessly integrated) */}
              {indianCinema.length > 0 && (
                <MovieRow
                  id="indian-cinema"
                  title="👑 Blockbusters of Indian Cinema"
                  subtitle="Kantara, RRR, K.G.F: Chapters 1 & 2, Pushpa, Salaar, Jawan, Animal, Hanu-Man"
                  items={indianCinema}
                  watchlistIds={watchlistIds}
                  badgeText="PAN-INDIA HITS"
                  onPlay={(m) => setPlayingMovie(m)}
                  onToggleWatchlist={handleToggleWatchlist}
                  onSelectMovie={(m) => setSelectedMovie(m)}
                />
              )}

              {/* 6. Netflix Global Originals */}
              {originals.length > 0 && (
                <MovieRow
                  id="originals"
                  title="🔴 Netflix Global Originals"
                  subtitle="Stranger Things, Wednesday, Squid Game, Money Heist, Dark, Black Mirror, The Queen's Gambit"
                  items={originals}
                  watchlistIds={watchlistIds}
                  onPlay={(m) => setPlayingMovie(m)}
                  onToggleWatchlist={handleToggleWatchlist}
                  onSelectMovie={(m) => setSelectedMovie(m)}
                />
              )}

              {/* 7. My Watchlist (Watchlist Service :8089) */}
              {watchlist.length > 0 && (
                <MovieRow
                  id="watchlist"
                  title="➕ My List"
                  subtitle="Saved titles ready to stream"
                  items={watchlist}
                  watchlistIds={watchlistIds}
                  badgeText="WATCHLIST SERVICE :8089"
                  onPlay={(m) => setPlayingMovie(m)}
                  onToggleWatchlist={handleToggleWatchlist}
                  onSelectMovie={(m) => setSelectedMovie(m)}
                />
              )}

              {/* 8. Trending Now */}
              <MovieRow
                id="trending"
                title="🔥 Trending Worldwide"
                subtitle="Most-watched titles worldwide from TMDB"
                items={trending}
                watchlistIds={watchlistIds}
                badgeText="CATALOG SERVICE :8087"
                onPlay={(m) => setPlayingMovie(m)}
                onToggleWatchlist={handleToggleWatchlist}
                onSelectMovie={(m) => setSelectedMovie(m)}
              />

              {/* 9. Critically Acclaimed Masterpieces */}
              <MovieRow
                id="top-rated"
                title="⭐ Critically Acclaimed Masterpieces"
                subtitle="Oppenheimer, Interstellar, Inception, Breaking Bad, The Dark Knight"
                items={topRated}
                watchlistIds={watchlistIds}
                onPlay={(m) => setPlayingMovie(m)}
                onToggleWatchlist={handleToggleWatchlist}
                onSelectMovie={(m) => setSelectedMovie(m)}
              />

              {/* 10. Sci-Fi & Speculative Fiction */}
              <MovieRow
                id="scifi"
                title="🚀 Sci-Fi & Speculative Fiction"
                subtitle="Dune 2, Spider-Verse, The Matrix, Dark, Blade Runner 2049"
                items={scifi}
                watchlistIds={watchlistIds}
                onPlay={(m) => setPlayingMovie(m)}
                onToggleWatchlist={handleToggleWatchlist}
                onSelectMovie={(m) => setSelectedMovie(m)}
              />

              {/* 11. High-Octane Action & Thrills */}
              <MovieRow
                id="action"
                title="💥 High-Octane Action & Thrills"
                subtitle="Top Gun: Maverick, Fight Club, The Dark Knight, Peaky Blinders"
                items={action}
                watchlistIds={watchlistIds}
                onPlay={(m) => setPlayingMovie(m)}
                onToggleWatchlist={handleToggleWatchlist}
                onSelectMovie={(m) => setSelectedMovie(m)}
              />

            </div>
          </>
        )}

      </main>

      {/* Netflix Authentic Footer */}
      <footer className="border-t border-zinc-800 bg-[#141414] py-10 text-xs text-zinc-500">
        <div className="max-w-[1920px] mx-auto px-4 sm:px-8 lg:px-12 space-y-6">
          <div className="flex flex-wrap items-center gap-6 text-zinc-400">
            <span className="font-bold text-zinc-300">Netflix Distributed Systems Research Workload</span>
            <span>Audio Description</span>
            <span>Help Centre</span>
            <span>Media Centre</span>
            <span>Terms of Use</span>
            <span>Privacy</span>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4 border-t border-zinc-900">
            <p className="text-zinc-500">
              © 2024-2026 Netflix Replica Workload • 5 Microservices: Catalog (:8087), User (:8088), Watchlist (:8089), History (:8092), Recommendation (:8093)
            </p>

            <div className="flex items-center gap-4 text-zinc-400">
              <a href="http://localhost:3000" target="_blank" rel="noopener noreferrer" className="hover:text-white flex items-center gap-1">
                <span>OmniStore (:3000)</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <a href="http://localhost:4000" target="_blank" rel="noopener noreferrer" className="hover:text-white flex items-center gap-1">
                <span>Dashboard (:4000)</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <a href="http://localhost:4001" target="_blank" rel="noopener noreferrer" className="hover:text-white flex items-center gap-1">
                <span>Fault Lab (:4001)</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* Video Player Modal */}
      {playingMovie && (
        <VideoPlayerModal
          movie={playingMovie}
          activeUser={activeProfile}
          onClose={() => setPlayingMovie(null)}
          onProgressSaved={() => {
            if (activeProfile?.id) {
              fetchContinueWatching(activeProfile.id).then(res => {
                if (res.data) setContinueWatching(res.data)
              })
              fetchRecommendations(activeProfile.id).then(res => {
                if (res.data) setRecommendations(res.data)
              })
            }
          }}
        />
      )}

      {/* Movie Details Modal */}
      {selectedMovie && (
        <MovieModal
          movie={selectedMovie}
          inWatchlist={watchlistIds.has(selectedMovie.id)}
          onClose={() => setSelectedMovie(null)}
          onPlay={(m) => {
            setSelectedMovie(null)
            setPlayingMovie(m)
          }}
          onToggleWatchlist={handleToggleWatchlist}
          onSelectSimilar={(sim) => setSelectedMovie(sim)}
        />
      )}

      {/* Microservices Observability Health Radar Modal */}
      {radarOpen && (
        <HealthRadarModal
          statuses={healthStatuses}
          onClose={() => setRadarOpen(false)}
          onRefresh={pollHealth}
          isRefreshing={refreshingRadar}
        />
      )}

    </div>
  )
}
