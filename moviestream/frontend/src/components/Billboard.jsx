import React, { useState } from 'react'
import { Play, Plus, Check, Info, Volume2, VolumeX } from 'lucide-react'

export default function Billboard({
  movie,
  inWatchlist,
  onPlay,
  onToggleWatchlist,
  onMoreInfo
}) {
  const [isMuted, setIsMuted] = useState(true)

  if (!movie) return null

  const backdropUrl = movie.backdrop_path 
    ? (movie.backdrop_path.startsWith('http') ? movie.backdrop_path : `https://image.tmdb.org/t/p/original${movie.backdrop_path}`)
    : 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=1920&q=80'

  const isSeries = movie.media_type === 'tv'
  const isRegional = movie.original_language === 'kn' || movie.original_language === 'te'

  return (
    <div className="relative h-[75vh] sm:h-[85vh] w-full select-none overflow-hidden bg-[#141414]">
      {/* Background Backdrop Image */}
      <img
        src={backdropUrl}
        alt={movie.title}
        className="w-full h-full object-cover object-top filter brightness-[0.72] contrast-[1.08]"
      />

      {/* Cinematic Gradient Overlays to pure Netflix Black #141414 */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/70 to-transparent w-full md:w-3/5" />

      {/* Foreground Content */}
      <div className="absolute bottom-16 sm:bottom-24 left-0 right-0 max-w-[1920px] mx-auto px-4 sm:px-8 lg:px-12 flex items-end justify-between">
        <div className="max-w-2xl lg:max-w-3xl space-y-4">
          
          {/* Netflix Film / Series Badge */}
          <div className="flex items-center gap-2">
            <span className="text-xl sm:text-2xl font-black text-[#E50914] tracking-tighter">N</span>
            <span className="text-xs sm:text-sm font-bold tracking-[0.3em] uppercase text-zinc-300">
              {isSeries ? 'S E R I E S' : 'F I L M'}
            </span>
            {isRegional && (
              <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-[#E50914]/20 text-[#E50914] border border-[#E50914]/40">
                {movie.region || (movie.original_language === 'kn' ? 'KANNADA' : 'TELUGU')}
              </span>
            )}
          </div>

          {/* Title */}
          <div>
            <h1 className="text-3xl sm:text-5xl lg:text-7xl font-black text-white tracking-tight leading-tight drop-shadow-2xl">
              {movie.title}
            </h1>
            {movie.tagline && (
              <p className="text-sm sm:text-lg font-medium text-zinc-300 italic mt-1 drop-shadow">
                "{movie.tagline}"
              </p>
            )}
          </div>

          {/* Netflix Top 10 Badge & Match Score */}
          <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm font-semibold">
            {/* Top 10 Ribbon */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#E50914] text-white font-bold text-xs shadow-md">
              <span className="text-[10px] font-black uppercase">TOP</span>
              <span className="text-sm font-black">10</span>
              <span className="hidden sm:inline text-xs font-normal">in India Today</span>
            </div>

            <span className="text-emerald-400 font-bold">
              {Math.round((movie.vote_average || 8.0) * 10 + 12)}% Match
            </span>

            <span className="px-1.5 py-0.5 rounded border border-zinc-500 text-zinc-300 text-xs font-mono">
              {movie.maturityRating || 'U/A 16+'}
            </span>

            <span className="text-zinc-300">
              {movie.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : '2 Seasons'}
            </span>

            <span className="px-1.5 py-0.5 rounded border border-zinc-600 bg-zinc-900/80 text-[10px] text-zinc-300 font-bold">
              Ultra HD 4K
            </span>

            <span className="px-1.5 py-0.5 rounded border border-zinc-600 bg-zinc-900/80 text-[10px] text-zinc-300 font-bold">
              5.1 Audio
            </span>
          </div>

          {/* Synopsis */}
          <p className="text-sm sm:text-base text-zinc-200 line-clamp-3 leading-relaxed drop-shadow max-w-2xl">
            {movie.overview}
          </p>

          {/* Netflix Authentic Action Buttons */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            
            {/* Play Button */}
            <button
              onClick={() => onPlay(movie)}
              className="flex items-center gap-2 px-6 sm:px-8 py-2.5 sm:py-3 rounded-md bg-white text-black font-bold text-sm sm:text-base hover:bg-zinc-200 transition-all shadow-xl active:scale-95"
            >
              <Play className="w-5 h-5 fill-black" />
              <span>Play</span>
            </button>

            {/* More Info Button */}
            <button
              onClick={() => onMoreInfo(movie)}
              className="flex items-center gap-2 px-6 sm:px-7 py-2.5 sm:py-3 rounded-md bg-zinc-600/70 hover:bg-zinc-600/90 text-white font-semibold text-sm sm:text-base transition-all backdrop-blur-sm active:scale-95"
            >
              <Info className="w-5 h-5" />
              <span>More Info</span>
            </button>

            {/* My List Quick Toggle */}
            <button
              onClick={() => onToggleWatchlist(movie)}
              className={`flex items-center gap-2 px-4 py-2.5 sm:py-3 rounded-md border text-sm font-semibold transition-all backdrop-blur-sm ${
                inWatchlist
                  ? 'bg-zinc-800/80 border-emerald-500/70 text-emerald-400'
                  : 'bg-zinc-900/60 border-zinc-600 text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {inWatchlist ? <Check className="w-4 h-4 text-emerald-400" /> : <Plus className="w-4 h-4" />}
              <span className="hidden sm:inline">{inWatchlist ? 'In List' : 'My List'}</span>
            </button>

          </div>

        </div>

        {/* Right Corner: Sound Toggle & Maturity Badge */}
        <div className="hidden sm:flex items-center gap-3">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-2.5 rounded-full border border-white/40 bg-black/40 hover:bg-black/70 text-white transition-colors backdrop-blur-sm"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>

          <div className="px-3 py-1 bg-zinc-900/80 border-l-4 border-zinc-400 text-zinc-200 font-bold text-xs uppercase tracking-wider backdrop-blur-sm">
            {movie.maturityRating || 'U/A 16+'}
          </div>
        </div>

      </div>
    </div>
  )
}
