import React, { useState, useEffect } from 'react'
import { X, Play, Plus, Check, Star, ThumbsUp, Volume2, VolumeX, Sparkles, Film, Info } from 'lucide-react'
import { fetchSimilarMovies } from '../services/api'

export default function MovieModal({
  movie,
  inWatchlist,
  onClose,
  onPlay,
  onToggleWatchlist,
  onSelectSimilar
}) {
  const [similar, setSimilar] = useState([])
  const [loadingSimilar, setLoadingSimilar] = useState(false)
  const [isLiked, setIsLiked] = useState(false)
  const [activeModalTab, setActiveModalTab] = useState('similar') // 'similar' | 'details'

  useEffect(() => {
    if (movie?.id) {
      setLoadingSimilar(true)
      fetchSimilarMovies(movie.id)
        .then(res => {
          if (res.data) setSimilar(res.data)
        })
        .finally(() => setLoadingSimilar(false))
    }
  }, [movie?.id])

  if (!movie) return null

  const backdropUrl = movie.backdrop_path 
    ? (movie.backdrop_path.startsWith('http') ? movie.backdrop_path : `https://image.tmdb.org/t/p/original${movie.backdrop_path}`)
    : 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=1920&q=80'

  const matchScore = Math.round((movie.vote_average || 8.0) * 10 + 12)
  const isSeries = movie.media_type === 'tv'
  const isRegional = movie.original_language === 'kn' || movie.original_language === 'te'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-4xl bg-[#181818] rounded-xl overflow-hidden border border-zinc-800 shadow-2xl my-auto text-zinc-200"
        onClick={e => e.stopPropagation()}
      >
        
        {/* Header Backdrop Banner */}
        <div className="relative aspect-[16/9] sm:aspect-[21/9] w-full overflow-hidden bg-black">
          <img
            src={backdropUrl}
            alt={movie.title}
            className="w-full h-full object-cover filter brightness-[0.75] contrast-[1.05]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-[#181818]/40 to-transparent" />

          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-[#181818]/80 hover:bg-[#181818] text-white transition-colors border border-white/10 z-20"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Floating Actions on Backdrop */}
          <div className="absolute bottom-6 left-6 right-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight drop-shadow-md">
                {movie.title}
              </h2>
              {movie.tagline && (
                <p className="text-xs sm:text-sm text-zinc-300 italic mt-0.5">"{movie.tagline}"</p>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Play Button */}
              <button
                onClick={() => {
                  onClose()
                  onPlay(movie)
                }}
                className="flex items-center gap-2 px-6 sm:px-8 py-2.5 rounded-md bg-white text-black font-bold text-sm sm:text-base hover:bg-zinc-200 transition-all shadow-xl active:scale-95"
              >
                <Play className="w-5 h-5 fill-black" />
                <span>Play</span>
              </button>

              {/* Add to List */}
              <button
                onClick={() => onToggleWatchlist(movie)}
                className={`p-2.5 rounded-full border transition-transform active:scale-90 ${
                  inWatchlist
                    ? 'bg-zinc-800 border-emerald-500 text-emerald-400'
                    : 'bg-black/70 border-zinc-400 text-white hover:border-white'
                }`}
                title={inWatchlist ? "Remove from List" : "Add to My List"}
              >
                {inWatchlist ? <Check className="w-5 h-5 text-emerald-400" /> : <Plus className="w-5 h-5" />}
              </button>

              {/* Like Button */}
              <button
                onClick={() => setIsLiked(!isLiked)}
                className={`p-2.5 rounded-full border transition-transform active:scale-90 ${
                  isLiked
                    ? 'bg-[#E50914]/20 border-[#E50914] text-[#E50914]'
                    : 'bg-black/70 border-zinc-400 text-white hover:border-white'
                }`}
                title="Rate Title"
              >
                <ThumbsUp className={`w-5 h-5 ${isLiked ? 'fill-[#E50914]' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Modal Body: Netflix 2-Column Details Layout */}
        <div className="p-6 sm:p-8 space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            
            {/* Left 2 Cols: Metadata, Ratings & Synopsis */}
            <div className="md:col-span-2 space-y-4">
              
              {/* Meta Tags */}
              <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
                <span className="text-emerald-400 font-bold">{matchScore}% Match</span>
                <span className="text-zinc-400">{movie.release_date?.substring(0, 4) || '2024'}</span>
                <span className="px-1.5 py-0.5 rounded border border-zinc-600 text-xs font-mono">
                  {movie.maturityRating || 'U/A 16+'}
                </span>
                <span className="text-zinc-300">
                  {movie.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : '1 Season'}
                </span>
                <span className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-300 font-bold">
                  Ultra HD 4K
                </span>
                <span className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-300 font-bold">
                  5.1 Spatial Audio
                </span>
              </div>

              {/* Synopsis */}
              <p className="text-sm sm:text-base text-zinc-200 leading-relaxed">
                {movie.overview}
              </p>

              {/* Audio & Subtitles specification */}
              <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 text-xs space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400 font-semibold w-24">Audio:</span>
                  <span className="text-zinc-200">
                    {movie.original_language === 'kn' ? 'Kannada [Original], Hindi, English [5.1]' : 
                     movie.original_language === 'te' ? 'Telugu [Original], Hindi, English [5.1]' :
                     'English [Original], Hindi, Spanish [5.1]'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400 font-semibold w-24">Subtitles:</span>
                  <span className="text-zinc-200">English, Kannada, Telugu, Hindi</span>
                </div>
              </div>

            </div>

            {/* Right 1 Col: Cast, Director, Genres & Tags */}
            <div className="space-y-3 text-xs border-t md:border-t-0 md:border-l border-zinc-800 md:pl-6 pt-4 md:pt-0">
              
              <div>
                <span className="text-zinc-400 block mb-0.5">Cast:</span>
                <p className="text-zinc-200 font-medium">
                  {movie.cast?.join(', ') || 'Featured Ensemble'}
                </p>
              </div>

              <div>
                <span className="text-zinc-400 block mb-0.5">Director:</span>
                <p className="text-zinc-200 font-medium">
                  {movie.director || 'Acclaimed Filmmaker'}
                </p>
              </div>

              <div>
                <span className="text-zinc-400 block mb-0.5">Genres:</span>
                <p className="text-zinc-200 font-medium">
                  {movie.genres?.map(g => g.name).join(', ') || 'Drama, Action'}
                </p>
              </div>

              <div>
                <span className="text-zinc-400 block mb-0.5">Maturity Rating:</span>
                <span className="px-1.5 py-0.5 rounded border border-zinc-600 text-zinc-300 font-mono text-[11px]">
                  U/A 16+
                </span>
                <p className="text-zinc-400 text-[10px] mt-1">Recommended for ages 16 and above. Violence, action, mature themes.</p>
              </div>

            </div>

          </div>

          {/* More Like This (Netflix Recommendations) */}
          <div className="pt-6 border-t border-zinc-800 space-y-4">
            <h3 className="text-lg font-bold text-white tracking-tight">
              More Like This
            </h3>

            {loadingSimilar ? (
              <div className="py-8 flex justify-center">
                <div className="netflix-spinner" />
              </div>
            ) : similar.length === 0 ? (
              <p className="text-xs text-zinc-500">Exploring recommendations...</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {similar.slice(0, 6).map((rec) => {
                  const recPoster = rec.poster_path 
                    ? (rec.poster_path.startsWith('http') ? rec.poster_path : `https://image.tmdb.org/t/p/w500${rec.poster_path}`)
                    : 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?auto=format&fit=crop&w=500&q=80'
                  const recScore = Math.round((rec.vote_average || 7.8) * 10 + 12)

                  return (
                    <div
                      key={rec.id}
                      onClick={() => {
                        if (onSelectSimilar) onSelectSimilar(rec)
                      }}
                      className="rounded-lg bg-zinc-900 overflow-hidden border border-zinc-800 hover:border-zinc-500 transition-all cursor-pointer group"
                    >
                      <div className="aspect-video relative overflow-hidden bg-black">
                        <img
                          src={recPoster}
                          alt={rec.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-bold text-emerald-400">
                          {recScore}%
                        </div>
                      </div>

                      <div className="p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white truncate max-w-[140px]">{rec.title}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onToggleWatchlist(rec)
                            }}
                            className="p-1 rounded-full border border-zinc-600 hover:border-white text-zinc-300"
                            title="Add to List"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-[11px] text-zinc-400 line-clamp-2">{rec.overview}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  )
}
