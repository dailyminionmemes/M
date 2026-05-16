import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Search, LogOut, Film, Tv, Star, 
  TrendingUp, BarChart3, Sparkles, Filter,
  History, Calendar, LayoutGrid, List,
  Loader2, Play, Info, MoreVertical, X, RotateCcw, Download,
  Edit2, Eye, Trash2, QrCode, Share2, Smartphone
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  auth, db, signInWithGoogle, signOut 
} from './lib/firebase';
import { 
  collection, query, where, orderBy, onSnapshot, 
  addDoc, deleteDoc, doc, updateDoc, serverTimestamp, getDocs
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { enrichContent, getRecommendations, nlpSearch } from './lib/api';
import { format } from 'date-fns';

// --- Types ---
interface LogEntry {
  id: string;
  userId: string;
  name: string;
  type: 'film' | 'series';
  rating: number;
  company: string;
  thumbnail_url: string;
  watched_on: string;
  date_watched: string;
  genres: string[];
  ai_tags: string[];
  summary?: string;
  age_rating?: string;
  createdAt: any;
}

// --- Components ---
function SafeImage({ src, alt, className }: { src: string, alt: string, className?: string }) {
  const [error, setError] = useState(false);
  const fallback = "https://images.unsplash.com/photo-1485846234645-a62644f84728?q=80&w=400&h=600&auto=format&fit=crop";
  
  return (
    <img 
      src={error || !src ? fallback : src} 
      alt={alt} 
      onError={() => !error && setError(true)}
      referrerPolicy="no-referrer"
      className={className} 
    />
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [recommendations, setRecommendations] = useState<any[]>(() => {
    const saved = localStorage.getItem('last_recommendations');
    return saved ? JSON.parse(saved) : [];
  });
  const [recStatus, setRecStatus] = useState<'loading' | 'success' | 'error' | 'quota'>(() => {
    const saved = localStorage.getItem('last_recommendations');
    return saved ? 'success' : 'loading';
  });
  const [recError, setRecError] = useState<string | null>(null);
  const [searchExplanation, setSearchExplanation] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [stats, setStats] = useState({ total: 0, avg: 0, topGenre: 'N/A', topPlatform: 'N/A' });
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Install Prompt Listener - Consolidated
  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const isIframe = window.self !== window.top;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          setDeferredPrompt(null);
        }
      } catch (err) {
        console.error('Install prompt failed:', err);
        setIsShareModalOpen(true);
      }
    } else if (isIframe) {
      window.open(window.location.href, '_blank');
    } else {
      setIsShareModalOpen(true); 
    }
  };

  const getLocalRecommendations = (logs: LogEntry[]) => {
    // Basic rule-based suggestions if AI is capped
    const genres = logs.flatMap(l => l.genres || []);
    const topGenre = genres.length > 0 ? genres.sort((a,b) => 
      genres.filter(v => v===a).length - genres.filter(v => v===b).length
    ).pop() : 'Action';

    return [
      { name: `More ${topGenre} Classics`, type: 'film', year: 2024, matchPercentage: 95, reason: `Based on your love for ${topGenre}`, thumbnail_url: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?q=80&w=400&h=600&auto=format&fit=crop' },
      { name: 'Top Trending Now', type: 'series', year: 2024, matchPercentage: 88, reason: 'Highly rated by others with similar taste', thumbnail_url: 'https://images.unsplash.com/photo-1598897611553-d6880da997fe?q=80&w=400&h=600&auto=format&fit=crop' },
      { name: 'Hidden Gem', type: 'film', year: 2023, matchPercentage: 82, reason: 'An underrated pick in your favorite genre', thumbnail_url: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=400&h=600&auto=format&fit=crop' },
      { name: 'Director Spotlight', type: 'film', year: 2024, matchPercentage: 79, reason: 'Masterpiece from a director you follow', thumbnail_url: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?q=80&w=400&h=600&auto=format&fit=crop' }
    ];
  };

  const handleExportCSV = () => {
    if (logs.length === 0) return;
    const headers = ['Name', 'Type', 'Platform', 'Genre', 'Rating', 'Date Watched'];
    
    const escapeCSV = (str: string) => {
      const escaped = String(str).replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const rows = logs.map(l => [
      escapeCSV(l.name), 
      escapeCSV(l.type), 
      escapeCSV(l.watched_on || 'Unknown'), 
      escapeCSV(l.genres?.join(' | ') || 'N/A'), 
      l.rating, 
      escapeCSV(l.date_watched ? format(new Date(l.date_watched), 'yyyy-MM-dd') : 'N/A')
    ].join(','));
    
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('download', `cinelog_history_${format(new Date(), 'yyyyMMdd')}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  // Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  // Data Listener
  useEffect(() => {
    if (!user) {
      setLogs([]);
      return;
    }

    const q = query(
      collection(db, 'logs'),
      where('userId', '==', user.uid),
      orderBy('date_watched', 'desc')
    );

    return onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as LogEntry[];
      setLogs(docs);
      setFilteredLogs(docs);
    });
  }, [user]);

  // Recommendations Logic
  useEffect(() => {
    if (user && logs.length > 0 && recommendations.length === 0 && recStatus !== 'error' && recStatus !== 'quota') {
      const fetchRecs = async () => {
        setRecStatus('loading');
        setRecError(null);
        try {
          const recs = await getRecommendations(logs.slice(0, 5));
          if (recs && recs.length > 0) {
            setRecommendations(recs);
            setRecStatus('success');
            localStorage.setItem('last_recommendations', JSON.stringify(recs));
            localStorage.setItem('last_recommendations_logs_count', logs.length.toString());
          } else {
            setRecStatus('error');
          }
        } catch (e: any) {
          console.error('Recommendations failed:', e);
          const errorMsg = e.message?.toLowerCase() || '';
          const isQuota = errorMsg.includes('quota') || errorMsg.includes('429') || errorMsg.includes('exhausted');
          setRecStatus(isQuota ? 'quota' : 'error');
          setRecError(e.message);

          if (isQuota) {
            const fallbackRecs = getLocalRecommendations(logs);
            setRecommendations(fallbackRecs);
          }
        }
      };
      
      // Check if we should refetch (e.g. if logs count changed significantly since last cache)
      const lastCount = parseInt(localStorage.getItem('last_recommendations_logs_count') || '0');
      const shouldRefetch = Math.abs(logs.length - lastCount) >= 3 || recommendations.length === 0;

      if (shouldRefetch) {
        const timer = setTimeout(fetchRecs, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [user, logs.length, recommendations.length, recStatus]);

  // NLP Search Logic
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setFilteredLogs(logs);
      setSearchExplanation(null);
      return;
    }

    setIsSearching(true);
    try {
      const result = await nlpSearch(searchQuery, logs);
      if (result) {
        if (result.explanation) {
          setSearchExplanation(result.explanation);
        } else {
          setSearchExplanation(null);
        }

        if (result.matchingIds && result.matchingIds.length > 0) {
          setFilteredLogs(logs.filter(log => 
            result.matchingIds.some((id: string) => {
              const needle = id.toLowerCase().trim();
              const haystack = log.name.toLowerCase().trim();
              return haystack.includes(needle) || needle.includes(haystack);
            })
          ));
        } else {
          // If the AI just explained something without returning IDs, it might not be a filter.
          // In that case, we keep the current list but show the explanation.
          if (!result.explanation) setFilteredLogs([]);
        }
      }
    } catch (e: any) {
      console.error('NLP Search failed, using local fallback:', e);
      setSearchExplanation(null);
      setFilteredLogs(logs.filter(log => 
        log.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.genres?.some(g => g.toLowerCase().includes(searchQuery.toLowerCase())) ||
        log.watched_on?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.company?.toLowerCase().includes(searchQuery.toLowerCase())
      ));
    } finally {
      setIsSearching(false);
    }
  };

  const [newLog, setNewLog] = useState({
    name: '',
    type: 'film' as 'film' | 'series',
    rating: 8.0,
    company: '',
    watched_on: 'Netflix',
    age_rating: 'PG-13',
    genres: '',
    thumbnail_url: '',
    summary: '',
  });

  const handleEditClick = (log: LogEntry, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsEditMode(true);
    setNewLog({
      name: log.name,
      type: log.type,
      rating: log.rating,
      company: log.company || '',
      watched_on: log.watched_on || '',
      age_rating: log.age_rating || '',
      genres: log.genres?.join(', ') || '',
      thumbnail_url: log.thumbnail_url || '',
      summary: log.summary || '',
    });
    setSelectedLog(log); // Keep track of which one we are editing
    setIsAddModalOpen(true);
  };

  const handleMagicFill = async () => {
    if (!newLog.name.trim()) return;
    setEnriching(true);
    try {
      const data = await enrichContent(newLog.name);
      setNewLog({
        ...newLog,
        name: data.name || newLog.name,
        type: data.type || newLog.type,
        company: data.company || '',
        genres: data.genres?.join(', ') || '',
        thumbnail_url: data.thumbnail_url || '',
        summary: data.summary || '',
      });
    } catch (e: any) {
      console.error('Failed to enrich:', e);
      alert(e.message?.includes('quota') ? 'Daily AI limit reached. Please fill manually.' : 'Could not find details for this title.');
    } finally {
      setEnriching(false);
    }
  };

  // Add/Edit Log Logic
  const handleAddLogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setEnriching(true);
    try {
      const logData = {
        name: newLog.name.trim(),
        type: newLog.type,
        rating: Number(newLog.rating),
        company: newLog.company.trim() || 'Core Production',
        thumbnail_url: newLog.thumbnail_url.trim() || `https://images.unsplash.com/photo-1485846234645-a62644f84728?q=80&w=400&h=600&auto=format&fit=crop`,
        watched_on: newLog.watched_on.trim(),
        age_rating: newLog.age_rating.trim(),
        genres: newLog.genres.split(',').map(g => g.trim()).filter(Boolean),
        summary: newLog.summary.trim(),
        ai_tags: [],
        userId: user.uid,
        updatedAt: serverTimestamp(),
      };

      if (isEditMode && selectedLog) {
        await updateDoc(doc(db, 'logs', selectedLog.id), logData);
      } else {
        await addDoc(collection(db, 'logs'), {
          ...logData,
          date_watched: new Date().toISOString(),
          createdAt: serverTimestamp(),
        });
      }
      
      setIsAddModalOpen(false);
      setIsEditMode(false);
      setSelectedLog(null);
      setNewLog({ name: '', type: 'film', rating: 8.0, company: '', watched_on: 'Netflix', age_rating: 'PG-13', genres: '', thumbnail_url: '', summary: '' });
    } catch (e) {
      console.error(e);
      alert('Operation failed. Please try again!');
    } finally {
      setEnriching(false);
    }
  };

  // Dashboard Stats
  useEffect(() => {
    if (logs.length === 0) return;
    const total = logs.length;
    const avg = logs.reduce((acc, log) => acc + (log.rating || 0), 0) / total;
    
    // Genres count
    const genreCounts: Record<string, number> = {};
    const platformCounts: Record<string, number> = {};
    logs.forEach(log => {
      log.genres?.forEach(g => {
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      });
      if (log.watched_on) {
        platformCounts[log.watched_on] = (platformCounts[log.watched_on] || 0) + 1;
      }
    });

    const topGenre = Object.entries(genreCounts).sort((a,b) => b[1] - a[1])[0]?.[0] || 'N/A';
    const topPlatform = Object.entries(platformCounts).sort((a,b) => b[1] - a[1])[0]?.[0] || 'N/A';

    setStats({ 
      total, 
      avg: parseFloat(avg.toFixed(1)),
      topGenre,
      topPlatform
    });
  }, [logs]);

  // Notification Logic
  useEffect(() => {
    if (user && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [user]);

  useEffect(() => {
    if (recommendations.length > 0 && logs.length > 0 && Notification.permission === 'granted') {
      const lastLiked = logs.find(l => l.rating >= 8);
      if (lastLiked) {
        const rec = recommendations[0];
        new Notification('CineLog AI Suggestion', {
          body: `Because you liked ${lastLiked.name}, you should watch ${rec.name}!`,
          icon: 'https://cdn-icons-png.flaticon.com/512/2503/2503508.png'
        });
      }
    }
  }, [recommendations, logs]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#050508]">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#050508] relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/20 rounded-full blur-[120px] animate-pulse-slow"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-purple-600/20 rounded-full blur-[120px] animate-pulse-slow"></div>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass p-12 rounded-3xl max-w-md w-full text-center z-10"
        >
          <div className="w-20 h-20 bg-gradient-to-tr from-indigo-600 to-purple-500 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-indigo-500/20">
            <Film className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold mb-4 tracking-tight">CineLog <span className="text-indigo-400">AI</span></h1>
          <p className="text-slate-400 mb-8 leading-relaxed text-lg font-light">
            Your personal cinema companion. Log watch history, get AI enrichment, and personalized recommendations.
          </p>
          <button 
            onClick={signInWithGoogle}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-4 rounded-2xl transition-all shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-3 active:scale-95"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#030305] text-slate-100 font-sans overflow-x-hidden mesh-gradient-vibrant">
      {/* Background blobs */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-cyan-600/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow"></div>
      <div className="fixed bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-pink-600/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow" style={{ animationDelay: '2s' }}></div>
      <div className="fixed top-[20%] right-[10%] w-[40%] h-[40%] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow" style={{ animationDelay: '4s' }}></div>

      {/* Navigation */}
      <header className="h-20 md:h-24 flex flex-col md:flex-row items-center justify-between px-4 md:px-8 z-50 glass sticky top-0 border-b border-white/5 gap-2 md:gap-0">
        <div className="flex items-center justify-between w-full md:w-auto mt-2 md:mt-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-gradient-to-tr from-indigo-600 via-purple-500 to-pink-500 rounded-xl md:rounded-2xl flex items-center justify-center shadow-2xl shadow-indigo-500/40 group hover:rotate-6 transition-transform">
              <Film className="w-6 h-6 md:w-7 md:h-7 text-white" />
            </div>
            <h1 className="text-xl md:text-2xl font-black tracking-tighter text-white">
              CineLog <span className="text-gradient-rainbow ml-1">AI</span>
            </h1>
          </div>
          
          <div className="flex items-center gap-2 md:hidden">
            <button 
              onClick={() => setIsShareModalOpen(true)}
              className="p-2 glass rounded-xl text-cyan-400"
            >
              <Smartphone className="w-5 h-5" />
            </button>
            <button 
              onClick={signOut}
              className="p-2 glass rounded-xl text-red-400"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <form onSubmit={handleSearch} className="w-full md:flex-1 md:max-w-xl mx-0 md:mx-12 mb-2 md:mb-0">
          <div className="relative group">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              {isSearching ? <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" /> : <Search className="w-5 h-5 text-slate-400 group-focus-within:text-cyan-400 transition-colors" />}
            </div>
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 md:py-4 pl-12 pr-4 text-xs md:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 backdrop-blur-3xl transition-all placeholder-slate-500 shadow-inner" 
              placeholder="Ask: 'Who directed Inception?' or 'Filter for Sci-fi'..."
            />
            <div className="absolute inset-y-0 right-4 flex items-center gap-2 hidden sm:flex">
              <span className="text-[9px] font-black bg-white/10 text-slate-400 px-2 py-1 rounded-md uppercase tracking-tighter border border-white/5">Super Search</span>
            </div>
          </div>
        </form>

        <div className="hidden md:flex items-center gap-6">
          <div className="flex items-center gap-3">
            <button 
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-white/10 transition-all group"
            >
              <Download className="w-3 h-3 group-hover:translate-y-0.5 transition-transform text-cyan-400" />
              Records
            </button>
            <button 
              onClick={handleInstallClick}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl group active:scale-95"
            >
              {deferredPrompt ? <Plus className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              {deferredPrompt ? "Execute Deploy" : "System Root"}
            </button>
          </div>
          <div className="text-right mr-2 border-l border-white/10 pl-6 hidden lg:block">
            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Master Director</p>
            <p className="text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400">Cinemaniac</p>
          </div>
          <button 
            onClick={signOut}
            className="w-10 h-10 rounded-xl glass flex items-center justify-center hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8 grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8">
        
        {/* Left Column: Stats & Insights */}
        <aside className="md:col-span-3 flex flex-col gap-6 order-2 mb-8 md:mb-0">
          <section className="glass rounded-3xl p-6 bg-gradient-to-br from-indigo-600/20 via-purple-600/20 to-pink-600/10 border-white/10 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-400/10 blur-3xl group-hover:bg-indigo-400/20 transition-all opacity-50"></div>
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-4 flex items-center gap-2">
              <TrendingUp className="w-3 h-3 text-cyan-400" />
              Impact
            </h3>
            <div className="grid grid-cols-2 gap-4 relative z-10">
              <div>
                <p className="text-2xl font-black text-gradient-rainbow">{stats.total}</p>
                <p className="text-[10px] text-slate-400 uppercase font-black tracking-tighter">Watched</p>
              </div>
              <div>
                <p className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500">{stats.avg}</p>
                <p className="text-[10px] text-slate-400 uppercase font-black tracking-tighter">Avg Rating</p>
              </div>
            </div>
          </section>

          <section className="glass rounded-3xl p-6 flex-1 bg-gradient-to-tr from-cyan-600/5 via-transparent to-pink-600/10 border-white/5">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-purple-400" />
              AI Insights
            </h3>
            <div className="space-y-4">
              <div className="bg-white/5 rounded-2xl p-4 border border-white/5 group hover:bg-white/10 transition-colors hover:border-purple-500/30">
                <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Top Genre</p>
                <p className="text-sm font-black text-gradient-vibrant">{stats.topGenre}</p>
              </div>
              <div className="bg-white/5 rounded-2xl p-4 border border-white/5 group hover:bg-white/10 transition-colors hover:border-indigo-500/30">
                <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Top Platform</p>
                <p className="text-sm font-black text-gradient-cyan">{stats.topPlatform}</p>
              </div>
              <div className="bg-white/5 rounded-2xl p-4 border border-white/5 group hover:bg-white/10 transition-colors">
                <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Mood Match</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="px-3 py-1 bg-cyan-500/10 text-cyan-300 text-[10px] font-bold rounded-full border border-cyan-500/20">Dark</span>
                  <span className="px-3 py-1 bg-pink-500/10 text-pink-300 text-[10px] font-bold rounded-full border border-pink-500/20">Intense</span>
                  <span className="px-3 py-1 bg-amber-500/10 text-amber-300 text-[10px] font-bold rounded-full border border-amber-500/20">Epic</span>
                </div>
              </div>
            </div>
          </section>

          <section className="glass rounded-3xl p-6 bg-gradient-to-br from-indigo-600/10 to-purple-600/10 border-indigo-500/20">
             <div className="flex items-center gap-2 mb-3">
               <Info className="w-4 h-4 text-indigo-400" />
               <p className="text-xs font-bold uppercase tracking-wider">AI Suggestion</p>
             </div>
             <p className="text-xs text-slate-400 italic leading-relaxed">
               "Your high rating for 'Succession' suggests you'd enjoy 'The Bear''s character depth and intensity."
             </p>
          </section>
        </aside>

        {/* Right Column: Library & Content */}
        <div className="md:col-span-9 flex flex-col gap-8 order-1 md:order-2">
          
          {/* Quick Add Section */}
          <section className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 rounded-[2rem] md:rounded-[2.5rem] p-6 md:p-10 relative overflow-hidden group shadow-2xl shadow-indigo-500/30">
            <div className="absolute top-0 right-0 p-4 md:p-8 opacity-10 group-hover:opacity-30 transition-opacity group-hover:rotate-12 duration-700">
              <Sparkles className="w-24 h-24 md:w-32 md:h-32 text-white" />
            </div>
            <div className="absolute bottom-[-10%] left-[-5%] w-40 h-40 bg-cyan-400/20 rounded-full blur-[80px]"></div>
            <div className="relative z-10">
              <h2 className="text-2xl md:text-4xl font-black mb-2 tracking-tighter text-white">Log your journey.</h2>
              <p className="text-indigo-100/80 mb-6 md:mb-8 max-w-sm font-medium text-sm md:text-base">
                Our AI search engine cross-references Google to give you the most accurate metadata instantly.
              </p>
              <button 
                onClick={() => setIsAddModalOpen(true)}
                className="w-full sm:w-auto bg-white text-[#050508] font-bold px-6 md:px-8 py-3 md:py-4 rounded-xl md:rounded-2xl flex items-center justify-center gap-3 hover:scale-105 transition-all shadow-xl active:scale-95"
              >
                <Plus className="w-5 h-5" />
                Add Film or Series
              </button>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Sparkles className={`w-4 h-4 ${recStatus === 'quota' ? 'text-indigo-400' : 'text-amber-400'}`} />
                {recStatus === 'quota' ? 'Smart Picks (Local)' : 'AI Picks'}
              </h3>
              <div className="flex items-center gap-4">
                {recStatus !== 'loading' && (
                  <button 
                    onClick={() => {
                      setRecStatus('loading');
                      setRecommendations([]);
                      localStorage.removeItem('last_recommendations');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-[9px] font-black uppercase tracking-tighter text-slate-400 hover:text-white hover:bg-white/10 transition-all group"
                  >
                    <RotateCcw className="w-3 h-3 group-hover:rotate-180 transition-transform duration-500" />
                    Refresh Suggestions
                  </button>
                )}
                {recStatus === 'quota' && (
                  <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-500/20 uppercase font-black tracking-tighter">AI Quota Hit - Using Local Engine</span>
                )}
              </div>
            </div>
            
            {recStatus === 'error' ? (
              <div className="glass rounded-3xl p-10 text-center border-2 border-dashed border-red-500/30 bg-red-500/5">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
                   <Info className="w-8 h-8 text-red-500" />
                </div>
                <h4 className="text-xl font-bold mb-2">AI Service Unavailable</h4>
                <p className="text-sm text-slate-400 mb-8 max-w-sm mx-auto leading-relaxed">
                  The AI service is experiencing a temporary outage. Please try again in a few minutes.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <button
                    onClick={() => {
                      setRecStatus('loading');
                      setRecommendations([]);
                      localStorage.removeItem('last_recommendations');
                    }}
                    className="inline-flex items-center gap-2 px-6 py-3 glass text-slate-300 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-all"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Retry Connection
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {recommendations.length > 0 ? recommendations.map((rec, idx) => (
                  <motion.div 
                    key={idx}
                    whileHover={{ y: -5 }}
                    className="group relative aspect-[2/3] rounded-3xl overflow-hidden glass border-white/5 cursor-pointer shadow-lg"
                  >
                    <SafeImage src={rec.thumbnail_url} alt={rec.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 opacity-60" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80"></div>
                    <div className="absolute bottom-0 left-0 p-4 w-full">
                      <p className="text-sm font-bold truncate">{rec.name}</p>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-slate-400 uppercase font-bold">{rec.type} • {rec.year}</span>
                        <span className="text-[10px] text-indigo-400 font-bold">{rec.matchPercentage}%</span>
                      </div>
                    </div>
                  </motion.div>
                )) : (
                  [1,2,3,4].map((i) => (
                    <div key={i} className="aspect-[2/3] rounded-3xl animate-pulse glass" />
                  ))
                )}
              </div>
            )}
          </section>

          {/* Share / Mobile Modal */}
          <AnimatePresence>
            {isShareModalOpen && (
              <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/90 backdrop-blur-xl"
                  onClick={() => setIsShareModalOpen(false)}
                />
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="glass p-8 rounded-[3rem] w-full max-w-sm relative z-10 text-center shadow-[0_0_50px_rgba(34,211,238,0.2)] border-cyan-500/20"
                >
                  <button 
                    onClick={() => setIsShareModalOpen(false)}
                    className="absolute top-6 right-6 p-2 text-slate-500 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>

                  <div className="w-16 h-16 bg-cyan-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Smartphone className="w-8 h-8 text-cyan-400" />
                  </div>
                  <h3 className="text-2xl font-black text-white mb-2 tracking-tighter italic uppercase">Activate Executive App</h3>
                  
                  <div className="space-y-6 mb-8 text-left">
                    <div className="p-4 bg-gradient-to-br from-cyan-500/10 to-indigo-500/10 rounded-2xl border border-white/10 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-16 h-16 bg-cyan-400/10 blur-2xl"></div>
                      <p className="text-[10px] font-black uppercase text-cyan-400 mb-2 flex items-center gap-2">
                        <Smartphone className="w-3 h-3" />
                        Android / Browser
                      </p>
                      <p className="text-[11px] text-slate-300">Open system menu (⋮) and select <span className="text-cyan-300 font-black italic">"Install App"</span>. Unlocks standalone executive mode.</p>
                    </div>
                    <div className="p-4 bg-gradient-to-br from-pink-500/10 to-purple-500/10 rounded-2xl border border-white/10 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-16 h-16 bg-pink-400/10 blur-2xl"></div>
                      <p className="text-[10px] font-black uppercase text-pink-400 mb-2 flex items-center gap-2">
                        <Share2 className="w-3 h-3" />
                        iOS / Safari
                      </p>
                      <p className="text-[11px] text-slate-300">Tap Share (<Share2 className="w-3 h-3 inline" />) and choose <span className="text-pink-300 font-black italic">"Add to Home Screen"</span> for full-screen immersive tracking.</p>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-3xl inline-block mb-8 shadow-2xl shadow-white/5 border-4 border-cyan-500/10">
                    <QRCodeSVG 
                      value={window.location.host.includes('ais-dev') || window.location.host.includes('ais-pre') ? `https://${window.location.host}` : window.location.href} 
                      size={140} 
                      level="H"
                      includeMargin={false}
                    />
                    <p className="text-[8px] text-slate-400 mt-2 uppercase font-black tracking-widest italic">Encrypted Secure Link</p>
                  </div>
                  
                  <div className="space-y-4">
                    <button 
                      onClick={() => {
                        const url = window.location.href;
                        navigator.clipboard.writeText(url);
                        alert('Log Link copied!');
                      }}
                      className="w-full py-4 glass rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 hover:text-white transition-all flex items-center justify-center gap-2"
                    >
                      <Share2 className="w-4 h-4 text-cyan-400" />
                      Copy System URL
                    </button>
                    {deferredPrompt && (
                      <button 
                        onClick={handleInstallClick}
                        className="w-full py-4 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-white hover:scale-105 transition-all shadow-lg active:scale-95"
                      >
                        Execute Installation
                      </button>
                    )}
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Activity Feed / Library */}
          <section className="mb-20 md:mb-0">
            <div className="flex flex-col sm:flex-row items-center justify-between mb-6 gap-4">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-400" />
                Library
              </h3>
              <div className="grid grid-cols-3 gap-2 p-1 glass rounded-2xl w-full sm:w-auto">
                <button className="px-3 md:px-5 py-2 md:py-2.5 text-[10px] md:text-xs font-black text-white bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl shadow-lg shadow-indigo-500/20 transition-all uppercase tracking-tighter">Everything</button>
                <button className="px-3 md:px-5 py-2 md:py-2.5 text-[10px] md:text-xs font-bold text-slate-400 hover:text-white transition-all uppercase tracking-tighter">Films</button>
                <button className="px-3 md:px-5 py-2 md:py-2.5 text-[10px] md:text-xs font-bold text-slate-400 hover:text-white transition-all uppercase tracking-tighter">Series</button>
              </div>
            </div>

            <AnimatePresence>
              {searchExplanation && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mb-8 p-6 glass rounded-3xl bg-gradient-to-r from-cyan-600/10 via-indigo-600/10 to-transparent border-cyan-500/20 relative"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-1.5 bg-cyan-500/20 rounded-lg">
                      <Sparkles className="w-4 h-4 text-cyan-400" />
                    </div>
                    <span className="text-[10px] font-black uppercase text-cyan-400 tracking-widest">AI Intelligence</span>
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {searchExplanation}
                  </p>
                  <button 
                    onClick={() => setSearchExplanation(null)}
                    className="absolute top-4 right-4 text-slate-500 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-4">
              {filteredLogs.length > 0 ? filteredLogs.map((log) => (
                <motion.div 
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  key={log.id} 
                  onClick={() => setSelectedLog(log)}
                  className="glass rounded-3xl p-4 flex items-center gap-4 group hover:bg-white/[0.07] transition-all cursor-pointer"
                >
                  <div className="w-16 h-20 rounded-2xl overflow-hidden flex-shrink-0 shadow-lg border-2 border-white/5 group-hover:border-indigo-500/50 transition-all">
                    <SafeImage src={log.thumbnail_url} className="w-full h-full object-cover" alt={log.name} />
                  </div>
                    <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-lg font-bold truncate group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-indigo-400 group-hover:to-pink-400 transition-all uppercase tracking-tight">{log.name}</h4>
                      <span className="px-2 py-0.5 rounded-md bg-white/5 text-slate-400 text-[9px] uppercase font-black tracking-tighter border border-white/5">
                        {log.age_rating || 'NR'}
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] uppercase font-black tracking-tighter ${log.type === 'film' ? 'bg-amber-500/20 text-amber-500 border border-amber-500/20' : 'bg-cyan-500/20 text-cyan-500 border border-cyan-500/20'}`}>
                        {log.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-500 fill-amber-500" /> {log.rating}</span>
                      <span className="hidden sm:block">•</span>
                      <span className="hidden sm:block truncate">{log.company}</span>
                      <span>•</span>
                      <span>{format(new Date(log.date_watched), 'MMM d, yyyy')}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 max-w-[200px] justify-end hidden sm:flex">
                    {log.genres.slice(0, 2).map((g, i) => (
                      <span key={i} className="text-[10px] text-slate-400 px-3 py-1 rounded-full border border-white/5">{g}</span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button 
                      onClick={(e) => handleEditClick(log, e)}
                      className="p-2 text-slate-500 hover:text-cyan-400 transition-all"
                      title="Edit Entry"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDoc(doc(db, 'logs', log.id));
                      }}
                      className="p-2 text-slate-500 hover:text-red-400 transition-all"
                      title="Delete Entry"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              )) : (
                <div className="text-center py-20 glass rounded-[3rem] border-dashed">
                  <div className="w-16 h-16 bg-slate-800 rounded-3xl flex items-center justify-center mx-auto mb-4">
                    <Film className="w-8 h-8 text-slate-600" />
                  </div>
                  <p className="text-slate-500">No logs found yet. Start by logging your favorite film!</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Floating Buttons for Mobile */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-4 z-[60] md:hidden">
        <button 
          onClick={handleInstallClick}
          className="w-14 h-14 bg-gradient-to-tr from-cyan-400 via-indigo-500 to-purple-600 rounded-2xl shadow-xl shadow-cyan-500/30 flex items-center justify-center hover:scale-110 active:scale-95 transition-all text-white border border-white/20"
          title="Install App"
        >
          <Smartphone className="w-6 h-6" />
        </button>
        <button 
          onClick={() => {
            setIsEditMode(false);
            setNewLog({ name: '', type: 'film', rating: 8.0, company: '', watched_on: 'Netflix', age_rating: 'PG-13', genres: '', thumbnail_url: '', summary: '' });
            setIsAddModalOpen(true);
          }}
          className="w-16 h-16 bg-gradient-to-tr from-pink-500 via-purple-600 to-indigo-600 rounded-2xl shadow-2xl shadow-purple-500/40 flex items-center justify-center hover:scale-110 transition-transform active:scale-95 text-white border border-white/20"
        >
          <Plus className="w-8 h-8 font-bold" />
        </button>
      </div>

      {/* Add Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
              onClick={() => {
                setIsAddModalOpen(false);
                setIsEditMode(false);
                setNewLog({ name: '', type: 'film', rating: 8.0, company: '', watched_on: 'Netflix', age_rating: 'PG-13', genres: '', thumbnail_url: '', summary: '' });
              }}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="glass p-8 rounded-[2.5rem] w-full max-w-lg relative z-10 shadow-3xl overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                <Film className="w-32 h-32" />
              </div>
              
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold flex items-center gap-3">
                  {isEditMode ? <Edit2 className="w-6 h-6 text-cyan-400" /> : <Plus className="w-6 h-6 text-indigo-400" />}
                  {isEditMode ? 'Edit Record' : 'Add New Record'}
                </h3>
              </div>
              
              <form onSubmit={handleAddLogSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto px-1 scrollbar-hide">
                <div>
                  <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest mb-1 block">Content Name</label>
                  <div className="flex gap-2">
                    <input 
                      autoFocus
                      required
                      value={newLog.name}
                      onChange={(e) => setNewLog({ ...newLog, name: e.target.value })}
                      placeholder="Inception, Succession..."
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={handleMagicFill}
                      disabled={enriching || !newLog.name}
                      className="px-4 bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 rounded-xl hover:bg-indigo-600 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                      {enriching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5 group-hover:scale-110 transition-transform" />}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest block">Description / Summary</label>
                    <button 
                      type="button"
                      onClick={handleMagicFill}
                      disabled={enriching || !newLog.name}
                      className="text-[9px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors disabled:opacity-50"
                    >
                      <Sparkles className="w-2.5 h-2.5" />
                      Auto-Gen
                    </button>
                  </div>
                   <textarea 
                    value={newLog.summary}
                    onChange={(e) => setNewLog({ ...newLog, summary: e.target.value })}
                    placeholder="Briefly describe why you liked it or what it's about..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all h-24 resize-none text-sm"
                   />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest mb-1 block">Type</label>
                    <select 
                      value={newLog.type}
                      onChange={(e) => setNewLog({ ...newLog, type: e.target.value as 'film' | 'series' })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    >
                      <option value="film">Film</option>
                      <option value="series">Series</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest mb-1 block">Rating (0-10)</label>
                    <input 
                      type="number" 
                      min="0" 
                      max="10" 
                      step="0.1"
                      value={newLog.rating}
                      onChange={(e) => setNewLog({ ...newLog, rating: Number(e.target.value) })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest mb-1 block">Studio / Company</label>
                    <input 
                      value={newLog.company}
                      onChange={(e) => setNewLog({ ...newLog, company: e.target.value })}
                      placeholder="e.g. A24, HBO"
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest mb-1 block">Age Rating</label>
                    <input 
                      value={newLog.age_rating}
                      onChange={(e) => setNewLog({ ...newLog, age_rating: e.target.value })}
                      placeholder="e.g. PG-13, R"
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest mb-1 block">Thumbnail URL</label>
                  <input 
                    value={newLog.thumbnail_url}
                    onChange={(e) => setNewLog({ ...newLog, thumbnail_url: e.target.value })}
                    placeholder="https://images.com/poster.jpg"
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm mb-2"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest mb-1 block">Watched On</label>
                    <input 
                      value={newLog.watched_on}
                      onChange={(e) => setNewLog({ ...newLog, watched_on: e.target.value })}
                      placeholder="e.g. Netflix, Cinema"
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-black text-slate-500 tracking-widest mb-1 block">Genres (comma separated)</label>
                    <input 
                      value={newLog.genres}
                      onChange={(e) => setNewLog({ ...newLog, genres: e.target.value })}
                      placeholder="Drama, Sci-Fi"
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                </div>
                
                <div className="flex gap-4 pt-4">
                   <button 
                    disabled={enriching}
                    type="submit"
                    className={`flex-1 ${isEditMode ? 'bg-cyan-600 shadow-cyan-500/20' : 'bg-indigo-600 shadow-indigo-500/20'} disabled:bg-slate-700 py-4 rounded-2xl font-bold flex items-center justify-center gap-3 active:scale-95 transition-all shadow-xl`}
                   >
                     {enriching ? <Loader2 className="w-5 h-5 animate-spin" /> : (isEditMode ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />)}
                     {enriching ? 'Processing...' : (isEditMode ? 'Update Entry' : 'Add Record')}
                   </button>
                   <button 
                    type="button"
                    onClick={() => {
                      setIsAddModalOpen(false);
                      setIsEditMode(false);
                      setNewLog({ name: '', type: 'film', rating: 8.0, company: '', watched_on: 'Netflix', age_rating: 'PG-13', genres: '', thumbnail_url: '', summary: '' });
                    }}
                    className="px-6 glass rounded-2xl font-bold hover:bg-white/10 active:scale-95 transition-all text-slate-300"
                   >
                    Cancel
                   </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedLog && !isEditMode && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-xl"
              onClick={() => setSelectedLog(null)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-dark rounded-[3rem] w-full max-w-4xl max-h-[90vh] relative z-10 shadow-3xl overflow-hidden flex flex-col md:flex-row"
            >
              <div className="w-full md:w-2/5 relative h-64 md:h-auto">
                <SafeImage src={selectedLog.thumbnail_url} alt={selectedLog.name} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent md:bg-gradient-to-r md:from-transparent md:via-black/20" />
              </div>
              
              <div className="flex-1 p-8 md:p-12 overflow-y-auto">
                <div className="flex items-start justify-between mb-8">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${selectedLog.type === 'film' ? 'bg-amber-500/20 text-amber-500' : 'bg-cyan-500/20 text-cyan-500'}`}>
                        {selectedLog.type}
                      </span>
                      <span className="text-slate-500 text-xs font-bold uppercase tracking-widest">{selectedLog.company}</span>
                    </div>
                    <h2 className="text-4xl font-black text-white tracking-tighter leading-none mb-4">{selectedLog.name}</h2>
                  </div>
                  <button 
                    onClick={() => setSelectedLog(null)}
                    className="p-3 glass rounded-2xl text-slate-500 hover:text-white transition-all shadow-xl"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 mb-8">
                   <div className="glass p-4 rounded-2xl text-center">
                     <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Your Rating</p>
                     <div className="flex items-center justify-center gap-1.5">
                       <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
                       <span className="text-xl font-black">{selectedLog.rating}</span>
                     </div>
                   </div>
                   <div className="glass p-4 rounded-2xl text-center">
                     <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Date Logged</p>
                     <p className="text-sm font-bold text-slate-300">{format(new Date(selectedLog.date_watched), 'MMM d, yyyy')}</p>
                   </div>
                   <div className="glass p-4 rounded-2xl text-center">
                     <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Watched On</p>
                     <p className="text-sm font-bold text-indigo-400">{selectedLog.watched_on}</p>
                   </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <h4 className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-3 flex items-center gap-2">
                       <History className="w-3 h-3 text-cyan-400" />
                       Synopsis / Notes
                    </h4>
                    <p className="text-slate-300 text-sm leading-relaxed font-medium">
                      {selectedLog.summary || 'No description provided. Run AI enrichment to pull the latest metadata.'}
                    </p>
                  </div>

                  <div>
                    <h4 className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-3">Genres</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedLog.genres?.map((g, i) => (
                        <span key={i} className="px-4 py-2 glass rounded-2xl text-xs font-bold text-slate-300 border border-white/5">{g}</span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-12 flex flex-wrap gap-4">
                  <button 
                    onClick={async () => {
                      setEnriching(true);
                      try {
                        const data = await enrichContent(selectedLog.name);
                        await updateDoc(doc(db, 'logs', selectedLog.id), {
                          ...data,
                          genres: data.genres || selectedLog.genres,
                          updatedAt: serverTimestamp()
                        });
                        setSelectedLog({ ...selectedLog, ...data });
                      } catch (e: any) {
                        alert('Force enrichment failed: ' + e.message);
                      } finally {
                        setEnriching(false);
                      }
                    }}
                    disabled={enriching}
                    className="flex-1 bg-gradient-to-br from-indigo-600/20 to-purple-600/20 border border-indigo-500/30 text-white font-black uppercase tracking-widest py-4 rounded-2xl flex items-center justify-center gap-3 hover:from-indigo-600/30 hover:to-purple-600/30 active:scale-95 transition-all group shadow-lg shadow-indigo-500/10"
                  >
                    {enriching ? <Loader2 className="w-5 h-5 animate-spin text-cyan-400" /> : <RotateCcw className="w-5 h-5 group-hover:rotate-180 transition-transform duration-700 text-indigo-400" />}
                    {enriching ? 'Forcefully Processing...' : 'FORCEFUL AI SCAN'}
                  </button>
                  <button 
                    onClick={() => handleEditClick(selectedLog)}
                    className="flex-1 bg-gradient-to-r from-cyan-600 to-indigo-600 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 shadow-2xl shadow-cyan-500/20 active:scale-95 transition-all"
                  >
                    <Edit2 className="w-5 h-5" />
                    Edit Details
                  </button>
                  <button 
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this record?')) {
                        deleteDoc(doc(db, 'logs', selectedLog.id));
                        setSelectedLog(null);
                      }
                    }}
                    className="px-8 glass text-red-400 hover:bg-red-400/10 font-bold rounded-2xl active:scale-95 transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="h-10 px-8 flex items-center justify-between text-[10px] text-slate-500 z-50 relative mt-12 bg-white/5 border-t border-white/5">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 underline decoration-indigo-500/30">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div> AI Engine Ready
          </span>
          <span className="hidden sm:inline">NLP Active</span>
        </div>
        <div className="flex gap-4">
          <span>{user.email}</span>
          <span>CineLog v1.0.0</span>
        </div>
      </footer>
    </div>
  );
}
