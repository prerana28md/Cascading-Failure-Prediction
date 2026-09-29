import React, { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Play, Plus, Check, Star, Info, ThumbsUp, ChevronDown } from 'lucide-react'

export default function MovieRow({
  id,
  title,
  subtitle,
  items = [],
  watchlistIds = new Set(),
  onPlay,
  onToggleWatchlist,
  onSelectMovie,
  showProgress = false,
  badgeText = null,
  isTop10 = false
}) {
  const scrollRef = useRef(null)
  const [likedMap, setLikedMap] = useState({})

  const scroll = (direction) => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current
      const scrollAmount = clientWidth * 0.75
      scrollRef.current.scrollTo({
        left: direction === 'left' ? scrollLeft - scrollAmount : scrollLeft + scrollAmount,
        behavior: 'smooth'
      })
    }
  }

  const handleToggleLike = (movieId) => {
    setLikedMap(prev => ({
      ...prev,
      [movieId]: !prev[movieId]
    }))
  }

  if (!items || items.length === 0) return null

  return (
    <div id={id} className="space-y-2 px-4 sm:px-8 lg:px-12 py-3 group/row relative">
      
      {/* Row Header */}
      <div className="flex items-baseline justify-between mb-1">
        <div className="flex items-center gap-3">
          <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-white tracking-tight hover:text-zinc-300 cursor-pointer transition-colors">
            {title}
          </h2>
          {badgeText && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
              {badgeText}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="hidden sm:block text-xs text-zinc-400">{subtitle}</p>
        )}
      </div>

      {/* Slider Shelf */}
      <div className="relative group/shelf">
        
        {/* Left Arrow Button */}
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-0 bottom-0 z-30 w-10 sm:w-14 bg-black/60 hover:bg-black/90 text-white flex items-center justify-center opacity-0 group-hover/shelf:opacity-100 transition-all rounded-r-md backdrop-blur-sm"
          title="Previous"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>

        {/* Horizontal Container */}
        <div
          ref={scrollRef}
          className="flex items-center gap-3 sm:gap-4 overflow-x-auto hide-scrollbar scroll-smooth py-3"
        >
          {items.map((movie, index) => {
            const inWatchlist = watchlistIds.has(movie.id)
            const isLiked = !!likedMap[movie.id]
            const isOriginal = movie.is_original || movie.media_type === 'tv'
            const matchScore = Math.round((movie.vote_average || 8.0) * 10 + 12)
            const posterUrl = movie.poster_path 
              ? (movie.poster_path.startsWith('http') ? movie.poster_path : `https://image.tmdb.org/t/p/w500${movie.poster_path}`)
              : 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?auto=format&fit=crop&w=500&q=80'

            return (
              <div
                key={movie.id}
                className="flex items-center flex-none group/card cursor-pointer"
              >
                {/* Netflix Top 10 Giant Ranked Number (1 - 10) */}
                {isTop10 && (
                  <div className="flex-none -mr-4 sm:-mr-6 z-10 select-none pointer-events-none">
                    <span 
                      className="netflix-rank-number text-7xl sm:text-8xl md:text-9xl tracking-tighter"
                      style={{
                        WebkitTextStroke: '4px #595959',
                        color: '#141414'
                      }}
                    >
                      {index + 1}
                    </span>
                  </div>
                )}

                {/* Movie Card */}
                <div
                  className="relative w-36 sm:w-44 md:w-52 rounded-md overflow-hidden bg-zinc-900 border border-zinc-800 transition-all duration-300 hover:scale-105 hover:z-20 hover:shadow-2xl hover:shadow-black"
                  onClick={() => onSelectMovie(movie)}
                >
                  {/* Poster Image */}
                  <div className="aspect-[2/3] w-full relative overflow-hidden bg-zinc-950">
                    <img
                      src={posterUrl}
                      alt={movie.title}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform duration-300"
                    />

                    {/* Netflix 'N' Badge on Originals */}
                    {isOriginal && (
                      <div className="absolute top-2 left-2 w-5 h-5 flex items-center justify-center font-black text-[#E50914] text-lg leading-none drop-shadow">
                        N
                      </div>
                    )}

                    {/* Top 10 Ribbon */}
                    {isTop10 && (
                      <div className="absolute top-0 right-0 bg-[#E50914] text-white text-[9px] font-black px-1.5 py-0.5 rounded-bl uppercase tracking-tighter">
                        TOP 10
                      </div>
                    )}

                    {/* Playback progress bar for Continue Watching row */}
                    {(showProgress || movie.percentage !== undefined) && (
                      <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-zinc-800">
                        <div
                          className="h-full bg-[#E50914] rounded-r"
                          style={{ width: `${movie.percentage || 45}%` }}
                        />
                      </div>
                    )}

                    {/* Hover Card Quick Action Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity p-2.5 flex flex-col justify-end">
                      <p className="text-xs font-bold text-white truncate drop-shadow">{movie.title}</p>
                      
                      {/* Netflix Quick Action Controls */}
                      <div className="flex items-center gap-1.5 my-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onPlay(movie)
                          }}
                          className="p-1.5 rounded-full bg-white text-black hover:bg-zinc-200 transition-transform active:scale-90"
                          title="Play"
                        >
                          <Play className="w-3.5 h-3.5 fill-black" />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleWatchlist(movie)
                          }}
                          className={`p-1.5 rounded-full border transition-transform active:scale-90 ${
                            inWatchlist
                              ? 'bg-zinc-800 border-emerald-500 text-emerald-400'
                              : 'bg-black/70 border-zinc-400 text-white hover:border-white'
                          }`}
                          title={inWatchlist ? "Remove from List" : "Add to List"}
                        >
                          {inWatchlist ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Plus className="w-3.5 h-3.5" />}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleLike(movie.id)
                          }}
                          className={`p-1.5 rounded-full border transition-transform active:scale-90 ${
                            isLiked
                              ? 'bg-[#E50914]/20 border-[#E50914] text-[#E50914]'
                              : 'bg-black/70 border-zinc-400 text-white hover:border-white'
                          }`}
                          title="I like this"
                        >
                          <ThumbsUp className={`w-3.5 h-3.5 ${isLiked ? 'fill-[#E50914]' : ''}`} />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectMovie(movie)
                          }}
                          className="ml-auto p-1.5 rounded-full bg-black/70 border border-zinc-400 text-white hover:border-white"
                          title="More Info"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Netflix Metadata Line */}
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-300">
                        <span className="text-emerald-400">{matchScore}% Match</span>
                        <span className="px-1 border border-zinc-500 rounded text-[9px]">U/A 16+</span>
                        <span>{movie.runtime ? `${movie.runtime}m` : '1 Season'}</span>
                        <span className="px-1 border border-zinc-600 rounded text-[8px] bg-zinc-900">HD</span>
                      </div>

                      {/* Genre Tags */}
                      <p className="text-[10px] text-zinc-400 truncate mt-1">
                        {movie.genres?.map(g => g.name).slice(0, 3).join(' • ') || 'Action • Thriller'}
                      </p>

                    </div>
                  </div>

                  {/* Card Bottom Meta (Visible when not hovering) */}
                  <div className="p-2 bg-[#181818]">
                    <h3 className="text-xs font-semibold text-zinc-200 truncate group-hover/card:text-[#E50914] transition-colors">
                      {movie.title}
                    </h3>
                    <div className="flex items-center justify-between mt-0.5 text-[11px] text-zinc-400">
                      <span>{movie.release_date?.substring(0, 4) || '2024'}</span>
                      <span className="text-emerald-400 font-medium">{matchScore}% Match</span>
                    </div>
                  </div>

                </div>

              </div>
            )
          })}
        </div>

        {/* Right Arrow Button */}
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-0 bottom-0 z-30 w-10 sm:w-14 bg-black/60 hover:bg-black/90 text-white flex items-center justify-center opacity-0 group-hover/shelf:opacity-100 transition-all rounded-l-md backdrop-blur-sm"
          title="Next"
        >
          <ChevronRight className="w-8 h-8" />
        </button>

      </div>
    </div>
  )
}
