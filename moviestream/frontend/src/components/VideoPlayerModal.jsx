import React, { useState, useEffect, useRef } from 'react'
import {
  ArrowLeft, Play, Pause, RotateCcw, RotateCw,
  Volume2, VolumeX, Maximize, MessageSquare,
  Gauge, Check, Activity
} from 'lucide-react'
import { reportPlaybackProgress, markMovieCompleted, fetchMovieTrailer } from '../services/api'

// Authentic Verified YouTube Trailer Registry
const VERIFIED_TRAILERS = {
  // Kannada Cinema (Sandalwood)
  'kantara': 'M2OnifMgvps',
  'kantara a legend: chapter 1': 'TMQUFhWm8C0',
  'kantara: chapter 1': 'TMQUFhWm8C0',
  'k.g.f: chapter 1': 'CmGfoaBOxM4',
  'kgf chapter 1': 'CmGfoaBOxM4',
  'kgf 1': 'CmGfoaBOxM4',
  'k.g.f: chapter 2': 'JKa05nyUmuQ',
  'kgf chapter 2': 'JKa05nyUmuQ',
  'kgf 2': 'JKa05nyUmuQ',
  'k.g.f: chapter 3': 'CmGfoaBOxM4',
  'kgf 3': 'CmGfoaBOxM4',
  '777 charlie': 'mObzABO76DU',
  'charlie 777': 'mObzABO76DU',
  'garuda gamana vrishabha vahana': 'BnuDHJcSd0Q',
  'sapta sagaradaache ello': 'k-a71F2Zp4w',
  'sapta sagaradaache ello: side a': 'k-a71F2Zp4w',
  'sapta sagaradaache ello - side a': 'k-a71F2Zp4w',
  'sapta sagaradaache ello: side b': 'uY-dI525W1Q',
  'sapta sagaradaache ello - side b': 'uY-dI525W1Q',
  'saptha sagaradaache ello': 'k-a71F2Zp4w',
  'saptha sagaradaache ello: side a': 'k-a71F2Zp4w',
  'saptha sagaradaache ello - side a': 'k-a71F2Zp4w',
  'saptha sagaradaache ello: side b': 'uY-dI525W1Q',
  'saptha sagaradaache ello - side b': 'uY-dI525W1Q',
  'vikrant rona': 'd_1_t3N7H38',
  'ugramm': 'eK-3V8FmQOQ',

  // Telugu Cinema (Tollywood)
  'rrr': 'i4pjiLGUTtk',
  'baahubali: the beginning': '3NQRhE772b0',
  'baahubali 1': '3NQRhE772b0',
  'baahubali 2: the conclusion': 'qD-6d8Wo3do',
  'baahubali 2': 'qD-6d8Wo3do',
  'pushpa: the rise': 'pKctjlpbBR4',
  'pushpa': 'pKctjlpbBR4',
  'pushpa: the rule - part 2': 'g3JUbgkWn3o',
  'pushpa 2: the rule': 'g3JUbgkWn3o',
  'pushpa 2': 'g3JUbgkWn3o',
  'salaar: cease fire - part 1': '42sP0Vd-lss',
  'salaar: part 1 – ceasefire': '42sP0Vd-lss',
  'salaar': '42sP0Vd-lss',
  'hanu-man': 'kU_P001T970',
  'hanuman': 'kU_P001T970',
  'kalki 2898 ad': 'rn7tdg6cpW4',
  'kalki': 'rn7tdg6cpW4',
  'devara part 1': 'Rk5b6v9Zp8k',
  'devara': 'Rk5b6v9Zp8k',
  'rangasthalam': 'sS-b7GjO6A8',

  // Hindi & Pan-India Cinema
  'jawan': 'COv52Qyctws',
  'animal': 'Dydmpfo68DA',
  'pathaan': 'vqu4zBiB4WQ',
  'stree 2': 'KVn5b5Mv_4o',
  'dangal': 'x_7YlGv9u1g',
  'sholay': 'x8h_1lYkP28',
  'leo': 'Po3jStA653o',
  'jailer': 'xenOE1Tma0A',
  'vikram': 'OKBMCLzPVI8',

  // Hollywood Blockbusters & Nolan
  'dune: part two': 'Way9Dexny3w',
  'dune 2': 'Way9Dexny3w',
  'dune': '8g18jFHCLXk',
  'dune (2021)': '8g18jFHCLXk',
  'oppenheimer': 'uYPbbksJxIg',
  'interstellar': 'zSWdZVtXT7E',
  'inception': 'YoHD9XEInc0',
  'the dark knight': 'EXeTwQWrcwY',
  'the dark knight rises': 'g8evyE9TuYg',
  'batman begins': 'vak9ZLfhGnQ',
  'the batman': 'mqqft2x_Aa4',
  'spider-man: across the spider-verse': 'cqGjhVJWtEg',
  'spider-man: into the spider-verse': 'tg52up16eq0',
  'spider-man: no way home': 'JfVOs4VSpmA',
  'top gun: maverick': 'giXco2jaZ_4',
  'avatar': '5PSNL1qE6VY',
  'avatar: the way of water': 'd9MyW72ELq0',
  'gladiator': 'P5ieIbInFpg',
  'gladiator ii': '4rgYUipGJNo',
  'deadpool & wolverine': '73_1biulkYk',
  'deadpool': 'ONHBaC-pfsk',
  'the matrix': 'vKQi3bBA1y8',
  'fight club': 'BdJKm16Co6M',
  'pulp fiction': 's7EdQ4FqbhY',
  'the shawshank redemption': 'PLl99DlL6b4',
  'avengers: endgame': 'TcMBFSGVi1c',
  'blade runner 2049': 'gCcx85zbxz4',

  // Global Series & Netflix Originals
  'stranger things': 'b9EkMc79ZSU',
  'wednesday': 'NakTu_VZxJ0',
  'squid game': 'oqxAJKy0ii4',
  'money heist': '_InqQJRqGW4',
  'dark': 'rrwycJ08PSA',
  'black mirror': 'V0UcNhk9GgM',
  'the queen\'s gambit': 'CDrieqwSdgI',
  'peaky blinders': 'oVzVdvGIC7U',
  'breaking bad': 'HhesaQXLuRY',
  'better call saul': 'HN4oyhmGOpA',
  'the witcher': 'ndl1W4ltcmg',
  'narcos': 'xl8hmgMNCBo',
  'the crown': 'JWtnJGOLEB0',
  'ozark': '5hAXVqrljbs',
  'house of the dragon': 'DotnJ7tTA34',
  'game of thrones': 'KPLWWIOCOOQ',
  'the boys': '06rueu_fh30',
  'shogun': 'yK6IqjL2qUo'
}

function resolveClientTrailer(title) {
  if (!title) return 'EXeTwQWrcwY'
  const t = title.toLowerCase().trim()
  if (VERIFIED_TRAILERS[t]) return VERIFIED_TRAILERS[t]

  // Substring matching
  for (const [key, val] of Object.entries(VERIFIED_TRAILERS)) {
    if (t.includes(key) || key.includes(t)) {
      return val
    }
  }

  // Thematic regional fallbacks (never Dune)
  if (t.includes('kannada') || t.includes('sandalwood') || t.includes('shetty')) return 'M2OnifMgvps'
  if (t.includes('telugu') || t.includes('tollywood') || t.includes('rajamouli')) return 'i4pjiLGUTtk'
  if (t.includes('hindi') || t.includes('bollywood') || t.includes('khan')) return 'COv52Qyctws'
  if (t.includes('space') || t.includes('sci-fi') || t.includes('alien')) return 'zSWdZVtXT7E'
  if (t.includes('series') || t.includes('season') || t.includes('show')) return 'b9EkMc79ZSU'

  // Default to The Dark Knight, NEVER Dune 2
  return 'EXeTwQWrcwY'
}

export default function VideoPlayerModal({
  movie,
  activeUser,
  onClose,
  onProgressSaved
}) {
  const [isPlaying, setIsPlaying] = useState(true)
  const [progressSec, setProgressSec] = useState(movie?.progressSeconds || 45)
  const durationSec = movie?.durationSeconds || (movie?.runtime ? movie.runtime * 60 : 7200)
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(0.8)
  const [speed, setSpeed] = useState(1.0)
  const [completed, setCompleted] = useState(false)
  const [showAudioDialog, setShowAudioDialog] = useState(false)
  const [selectedAudio, setSelectedAudio] = useState(
    movie?.original_language === 'kn' ? 'kn' : movie?.original_language === 'te' ? 'te' : 'en'
  )
  const [selectedSubtitle, setSelectedSubtitle] = useState('en')
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideControlsTimer = useRef(null)
  const progressTimerRef = useRef(null)

  const [trailerKey, setTrailerKey] = useState(() => {
    if (!movie) return 'EXeTwQWrcwY'
    const rawKey = movie.trailer_key
    const isDune = movie.title?.toLowerCase().includes("dune")
    if (rawKey && (rawKey !== "Way9Dexny3w" || isDune)) {
      return rawKey
    }
    return resolveClientTrailer(movie.title)
  })

  // Dynamically query authentic verified trailer endpoint
  useEffect(() => {
    let isMounted = true
    if (movie?.id) {
      fetchMovieTrailer(movie.id).then(res => {
        if (isMounted && res?.data?.trailerKey) {
          const isDune = movie.title?.toLowerCase().includes("dune")
          if (res.data.trailerKey !== "Way9Dexny3w" || isDune) {
            setTrailerKey(res.data.trailerKey)
          }
        }
      }).catch(() => {})
    }
    return () => { isMounted = false }
  }, [movie?.id, movie?.title])

  const progressPercent = Math.min(100, Math.round((progressSec / durationSec) * 100))

  // Autohide controls after inactivity
  const handleMouseMove = () => {
    setControlsVisible(true)
    clearTimeout(hideControlsTimer.current)
    hideControlsTimer.current = setTimeout(() => {
      if (isPlaying) setControlsVisible(false)
    }, 3500)
  }

  // Playback timer simulation
  useEffect(() => {
    if (isPlaying && !completed) {
      progressTimerRef.current = setInterval(() => {
        setProgressSec(prev => {
          const next = prev + 1
          if (next >= durationSec) {
            setCompleted(true)
            return durationSec
          }
          return next
        })
      }, 1000 / speed)
    } else {
      clearInterval(progressTimerRef.current)
    }

    return () => clearInterval(progressTimerRef.current)
  }, [isPlaying, completed, durationSec, speed])

  // Periodic persistence to History Service (:8092)
  useEffect(() => {
    const saveInterval = setInterval(() => {
      if (activeUser?.id && movie?.id) {
        reportPlaybackProgress(activeUser.id, {
          movieId: movie.id,
          id: movie.id,
          title: movie.title,
          progressSeconds: progressSec,
          durationSeconds: durationSec,
          poster_path: movie.poster_path,
          backdrop_path: movie.backdrop_path,
          completed: completed || progressPercent >= 95
        }).then(() => {
          if (onProgressSaved) onProgressSaved()
        })
      }
    }, 4000)

    return () => clearInterval(saveInterval)
  }, [activeUser, movie, progressSec, durationSec, completed, progressPercent, onProgressSaved])

  const formatTime = (totalSeconds) => {
    const hours = Math.floor(totalSeconds / 3600)
    const mins = Math.floor((totalSeconds % 3600) / 60)
    const secs = totalSeconds % 60
    if (hours > 0) {
      return `${hours}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`
  }

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pos = (e.clientX - rect.left) / rect.width
    const targetSec = Math.floor(pos * durationSec)
    setProgressSec(targetSec)
  }

  const handleSkip = (seconds) => {
    setProgressSec(prev => Math.max(0, Math.min(durationSec, prev + seconds)))
  }

  const toggleSpeed = () => {
    const speeds = [0.75, 1.0, 1.25, 1.5]
    const nextIdx = (speeds.indexOf(speed) + 1) % speeds.length
    setSpeed(speeds[nextIdx])
  }

  // Handle Escape key to close player
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [progressSec, durationSec, completed, progressPercent])

  const handleClose = async () => {
    if (activeUser?.id && movie?.id) {
      try {
        await reportPlaybackProgress(activeUser.id, {
          movieId: movie.id,
          id: movie.id,
          title: movie.title,
          progressSeconds: progressSec,
          durationSeconds: durationSec,
          poster_path: movie.poster_path,
          backdrop_path: movie.backdrop_path,
          completed: completed || progressPercent >= 95
        })
        if (onProgressSaved) onProgressSaved()
      } catch (err) {
        console.error("Error saving playback progress on exit:", err)
      }
    }
    onClose()
  }

  if (!movie) return null

  return (
    <div 
      className="fixed inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden select-none animate-in fade-in duration-300"
      onMouseMove={handleMouseMove}
    >
      {/* Top Header Bar */}
      <div 
        className={`p-4 sm:p-6 bg-gradient-to-b from-black/90 via-black/40 to-transparent flex items-center justify-between z-30 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <button
          onClick={handleClose}
          className="flex items-center gap-3 text-white hover:text-zinc-300 transition-colors group"
          title="Back to Netflix Browse (Esc)"
        >
          <ArrowLeft className="w-6 h-6 group-hover:-translate-x-1 transition-transform" />
          <div>
            <h2 className="text-base sm:text-xl font-bold tracking-tight text-white drop-shadow">
              {movie.title}
            </h2>
            <span className="text-xs text-zinc-400">
              {movie.media_type === 'tv' ? 'Season 1 • Episode 1' : 'Feature Presentation • 4K UHD'}
            </span>
          </div>
        </button>

        <div className="flex items-center gap-3 text-xs">
          <span className="px-2.5 py-1 rounded bg-[#E50914] text-white font-bold tracking-wider">
            NETFLIX STREAM
          </span>
        </div>
      </div>

      {/* Main Video Canvas Area */}
      <div className="relative flex-1 w-full bg-black flex items-center justify-center overflow-hidden">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&mute=${isMuted ? 1 : 0}&controls=0&modestbranding=1&rel=0&enablejsapi=1`}
          title={movie.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full h-full border-0 pointer-events-auto"
        />
      </div>

      {/* Audio & Subtitles Dialog Modal */}
      {showAudioDialog && (
        <div 
          className="absolute right-8 bottom-24 w-80 rounded-xl bg-[#181818]/95 border border-zinc-700 p-4 shadow-2xl z-40 text-xs animate-in fade-in slide-in-from-bottom-2 duration-150 backdrop-blur-md"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-2 border-b border-zinc-700 font-bold text-white">
            <span>Audio & Subtitles</span>
            <button onClick={() => setShowAudioDialog(false)} className="text-zinc-400 hover:text-white">✕</button>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-3">
            {/* Audio Language Selection */}
            <div>
              <p className="font-semibold text-zinc-300 mb-2 uppercase text-[10px] tracking-wider">Audio</p>
              <div className="space-y-1">
                {[
                  { id: 'kn', label: 'Kannada [Original]' },
                  { id: 'te', label: 'Telugu [Original]' },
                  { id: 'hi', label: 'Hindi [5.1]' },
                  { id: 'en', label: 'English [5.1]' }
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setSelectedAudio(opt.id)}
                    className={`w-full text-left px-2 py-1.5 rounded transition-colors ${
                      selectedAudio === opt.id ? 'bg-[#E50914]/20 text-white font-semibold' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Subtitles Selection */}
            <div>
              <p className="font-semibold text-zinc-300 mb-2 uppercase text-[10px] tracking-wider">Subtitles</p>
              <div className="space-y-1">
                {[
                  { id: 'off', label: 'Off' },
                  { id: 'en', label: 'English' },
                  { id: 'kn', label: 'Kannada' },
                  { id: 'te', label: 'Telugu' },
                  { id: 'hi', label: 'Hindi' }
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setSelectedSubtitle(opt.id)}
                    className={`w-full text-left px-2 py-1.5 rounded transition-colors ${
                      selectedSubtitle === opt.id ? 'bg-[#E50914]/20 text-white font-semibold' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Netflix Control Bar */}
      <div 
        className={`p-4 sm:p-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent z-30 transition-opacity duration-300 space-y-3 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Red Scrubber Bar */}
        <div 
          onClick={handleSeek}
          className="relative w-full h-1.5 sm:h-2 bg-zinc-700/80 rounded-full cursor-pointer group/bar overflow-hidden hover:h-2.5 transition-all"
        >
          <div 
            className="h-full bg-[#E50914] relative transition-all duration-150"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Playback Controls Row */}
        <div className="flex items-center justify-between text-white">
          
          {/* Left Controls: Play, Skips, Volume */}
          <div className="flex items-center gap-4 sm:gap-6">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-1.5 hover:text-zinc-300 transition-colors"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="w-6 h-6 fill-white" /> : <Play className="w-6 h-6 fill-white" />}
            </button>

            <button
              onClick={() => handleSkip(-10)}
              className="p-1.5 hover:text-zinc-300 transition-colors flex items-center gap-0.5 text-xs font-bold"
              title="Rewind 10 seconds"
            >
              <RotateCcw className="w-5 h-5" />
              <span>10</span>
            </button>

            <button
              onClick={() => handleSkip(10)}
              className="p-1.5 hover:text-zinc-300 transition-colors flex items-center gap-0.5 text-xs font-bold"
              title="Forward 10 seconds"
            >
              <RotateCw className="w-5 h-5" />
              <span>10</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="p-1.5 hover:text-zinc-300 transition-colors"
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
              </button>
            </div>

            <span className="text-xs sm:text-sm font-medium text-zinc-300">
              {formatTime(progressSec)} / {formatTime(durationSec)}
            </span>
          </div>

          {/* Right Controls: Audio/Subs, Speed, Microservice Sync, Fullscreen */}
          <div className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm">
            
            <button
              onClick={() => setShowAudioDialog(!showAudioDialog)}
              className="flex items-center gap-1.5 p-1.5 hover:text-zinc-300 transition-colors"
              title="Audio & Subtitles"
            >
              <MessageSquare className="w-5 h-5" />
              <span className="hidden sm:inline font-semibold">Audio & Subs</span>
            </button>

            <button
              onClick={toggleSpeed}
              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-bold font-mono transition-colors"
              title="Playback Speed"
            >
              {speed}x
            </button>

            <div className="hidden md:flex items-center gap-2 pl-3 border-l border-zinc-700 text-xs text-zinc-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>History Service (:8092)</span>
            </div>

            <button
              onClick={() => {
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen().catch(() => {})
                } else {
                  document.exitFullscreen().catch(() => {})
                }
              }}
              className="p-1.5 hover:text-zinc-300 transition-colors"
              title="Toggle Fullscreen"
            >
              <Maximize className="w-5 h-5" />
            </button>
          </div>

        </div>

      </div>

    </div>
  )
}
