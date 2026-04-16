import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Cloud, 
  CloudRain, 
  Sun, 
  Wind, 
  Droplets, 
  Search, 
  MapPin, 
  Briefcase, 
  Map, 
  Lightbulb,
  AlertCircle,
  Thermometer,
  CloudLightning,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Initialize Gemini
const genAI = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || '' 
});

interface WeatherData {
  main: {
    temp: number;
    humidity: number;
    feels_like: number;
  };
  weather: Array<{
    description: string;
    main: string;
    icon: string;
  }>;
  name: string;
}

interface TravelAdvice {
  packing: string[];
  plan: string;
  proTip: string;
}

export default function App() {
  const [city, setCity] = useState('Chennai');
  const [inputCity, setInputCity] = useState('');
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [advice, setAdvice] = useState<TravelAdvice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = async (targetCity: string, isDemo = false) => {
    if (isDemo) {
      setLoading(true);
      setError(null);
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 800));
      const demoData: WeatherData = {
        name: targetCity,
        main: { temp: 28, humidity: 65, feels_like: 30 },
        weather: [{ description: 'partly cloudy', main: 'Clouds', icon: '03d' }]
      };
      setWeather(demoData);
      await generateAdvice(demoData);
      setLoading(false);
      return;
    }

    const apiKey = (import.meta as any).env.VITE_OPENWEATHER_API_KEY;
    
    if (!apiKey || apiKey === "") {
      setError('OpenWeatherMap API Key is missing. Please add "VITE_OPENWEATHER_API_KEY" to your Secrets panel in the AI Studio Settings (or use the Demo mode below).');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${targetCity}&units=metric&appid=${apiKey}`
      );
      if (!response.ok) {
        if (response.status === 401) throw new Error('Invalid API Key. Please check your OpenWeatherMap key.');
        throw new Error('City not found. Please check the spelling.');
      }
      const data = await response.json();
      setWeather(data);
      await generateAdvice(data);
    } catch (err: any) {
      setError(err.message);
      setWeather(null);
      setAdvice(null);
    } finally {
      setLoading(false);
    }
  };

  const generateAdvice = async (weatherData: WeatherData) => {
    try {
      const temp = weatherData.main.temp;
      const desc = weatherData.weather[0].description;
      const humidity = weatherData.main.humidity;

      const prompt = `
        Context: You are a smart travel assistant.
        Input: The weather in ${weatherData.name} is ${temp}°C, ${desc}, with ${humidity}% humidity.
        
        Task: Provide a tourist guide as a JSON object with:
        1. packing: An array of 4 specific items to carry and wear.
        2. plan: A 2-sentence paragraph suggesting indoor vs outdoor activities.
        3. proTip: One specific tip for these conditions.
        
        Format example:
        {
          "packing": ["Item 1", "Item 2", "Item 3", "Item 4"],
          "plan": "Because of the weather, you should...",
          "proTip": "Check local timings..."
        }
        
        Important: Return ONLY the raw JSON object. No conversation, no markdown formatting.
      `;

      const response = await genAI.models.generateContent({
        model: "gemini-flash-latest",
        contents: prompt,
      });

      const text = response.text || '';
      // More robust JSON extraction in case AI wraps it in markdown
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const cleanedText = jsonMatch ? jsonMatch[0] : text;
      
      const result = JSON.parse(cleanedText);
      setAdvice(result);
    } catch (err) {
      console.error('Gemini error:', err);
      setError('The AI had trouble organizing your travel plan. Please click search again.');
    }
  };

  useEffect(() => {
    // Attempt initial fetch, but only if key exists
    const apiKey = (import.meta as any).env.VITE_OPENWEATHER_API_KEY;
    if (apiKey && apiKey !== "") {
      fetchWeather(city);
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputCity.trim()) {
      setCity(inputCity);
      fetchWeather(inputCity);
    }
  };

  const handleUseDemo = () => {
    fetchWeather('Chennai', true);
  };

  const getWeatherIcon = (main: string) => {
    switch (main.toLowerCase()) {
      case 'clear': return <Sun className="w-12 h-12 text-yellow-500" />;
      case 'clouds': return <Cloud className="w-12 h-12 text-gray-400" />;
      case 'rain': 
      case 'drizzle': return <CloudRain className="w-12 h-12 text-blue-500" />;
      case 'thunderstorm': return <CloudLightning className="w-12 h-12 text-purple-600" />;
      default: return <Wind className="w-12 h-12 text-gray-500" />;
    }
  };

  const getWeatherTheme = (main: string = '') => {
    // Subtle tints for the natural theme
    const condition = main.toLowerCase();
    if (condition === 'clear') return 'bg-white border-amber-200/50';
    if (condition === 'clouds') return 'bg-white border-natural-sage/20';
    if (condition === 'rain' || condition === 'drizzle') return 'bg-white border-blue-200/50';
    if (condition === 'thunderstorm') return 'bg-white border-purple-200/50';
    return 'bg-white border-natural-sand';
  };

  return (
    <div className="min-h-screen bg-natural-bg text-natural-ink p-6 md:p-12 selection:bg-natural-sand/50">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-bottom border-natural-sand pb-6 border-b">
          <div>
            <span className="text-[10px] uppercase tracking-[2px] font-bold text-natural-muted opacity-80 mb-2 block">
              SkyGuide Smart Travel Assistant
            </span>
            <h1 className="text-5xl md:text-6xl font-serif font-normal tracking-tight text-natural-ink leading-none">
              {weather ? `${weather.name}` : 'SkyGuide'}
            </h1>
          </div>

          <form onSubmit={handleSearch} className="relative w-full md:w-80 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-natural-muted group-focus-within:text-natural-earth transition-colors" />
            <input
              type="text"
              placeholder="Enter destination..."
              className="w-full bg-natural-sand/30 border border-natural-sand rounded-full py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-natural-earth/10 focus:border-natural-earth/50 transition-all font-sans text-sm"
              value={inputCity}
              onChange={(e) => setInputCity(e.target.value)}
            />
          </form>
        </header>

        {/* Error State */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-red-50/50 border border-red-100 text-red-800 p-6 rounded-3xl flex items-start gap-3 shadow-sm"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500" />
              <div>
                <p className="font-serif font-bold text-lg">Input adjustment needed</p>
                <p className="text-sm opacity-90 font-sans italic mb-4">{error}</p>
                {error.includes('VITE_OPENWEATHER_API_KEY') && (
                  <button 
                    onClick={handleUseDemo}
                    className="px-4 py-2 bg-neutral-900 text-white rounded-full text-xs font-bold uppercase tracking-widest hover:bg-neutral-800 transition-colors"
                  >
                    Use Demo Data
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!error && !weather && !loading && (
          <div className="text-center py-32 bg-white/50 border border-dashed border-natural-sand rounded-[40px] flex flex-col items-center">
            <MapPin className="w-12 h-12 text-natural-sand mb-4" />
            <p className="font-serif italic text-natural-muted mb-8">Begin your journey by searching for a city above</p>
            <button 
              onClick={handleUseDemo}
              className="px-6 py-3 bg-natural-sand text-natural-ink rounded-full text-xs font-bold uppercase tracking-widest hover:bg-natural-sand/80 transition-all shadow-sm"
            >
              Try with Demo Data
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-32 space-y-6">
            <Loader2 className="w-12 h-12 text-natural-earth animate-spin stroke-[1.5px]" />
            <p className="text-natural-muted font-serif italic text-lg animate-pulse">Consulting the natural landscape & AI...</p>
          </div>
        )}

        {/* Weather & Advice Dashboard */}
        <AnimatePresence mode="wait">
          {weather && !loading && (
            <motion.div 
              key={weather.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              {/* Weather Info Section */}
              <div className="flex flex-col md:flex-row items-center justify-between gap-8 pb-8 border-b border-natural-sand/50">
                <div className="flex items-center gap-6">
                   <div className="p-6 bg-white rounded-full shadow-sm border border-natural-sand/30">
                     {getWeatherIcon(weather.weather[0].main)}
                   </div>
                   <div>
                     <div className="text-3xl font-light text-natural-earth font-sans">
                       {Math.round(weather.main.temp)}°C
                     </div>
                     <div className="flex flex-col">
                        <span className="text-[11px] uppercase tracking-[2px] font-bold text-natural-muted leading-tight">
                          {weather.weather[0].description}
                        </span>
                        <span className="text-[11px] uppercase tracking-[1px] font-bold text-natural-muted/60 leading-tight">
                          {weather.main.humidity}% Humidity
                        </span>
                     </div>
                   </div>
                </div>

                <div className="hidden md:flex items-center gap-12">
                   <div className="text-center">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-natural-muted mb-1 block">Feels Like</span>
                      <span className="text-2xl font-light text-natural-ink">{Math.round(weather.main.feels_like)}°</span>
                   </div>
                   <div className="text-center">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-natural-muted mb-1 block">Update Status</span>
                      <span className="px-3 py-1 bg-natural-sand rounded-full text-[10px] uppercase tracking-wider font-bold text-natural-ink block">Live Weather</span>
                   </div>
                </div>
              </div>

              {/* Advice Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
                 {/* Packing List */}
                 <motion.section 
                   initial={{ opacity: 0, y: 20 }}
                   animate={{ opacity: 1, y: 0 }}
                   transition={{ delay: 0.1 }}
                   className="bg-white p-10 rounded-[32px] border border-natural-sage/10 shadow-lg shadow-natural-sage/5 flex flex-col"
                 >
                    <div className="text-2xl font-serif italic text-natural-ink mb-6">Packing Essentials</div>
                    <ul className="space-y-5 flex-grow">
                      {advice?.packing.map((item, i) => (
                        <li key={i} className="flex items-start gap-4 text-sm text-neutral-600 leading-relaxed">
                          <span className="text-natural-sage font-bold leading-none mt-1">•</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                 </motion.section>

                 {/* The Plan */}
                 <motion.section 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-white p-10 rounded-[32px] border border-natural-sage/10 shadow-lg shadow-natural-sage/5"
                 >
                    <div className="text-2xl font-serif italic text-natural-ink mb-6">The Daily Plan</div>
                    <div className="space-y-4">
                      {advice?.plan.split('. ').map((sentence, i) => sentence && (
                        <p key={i} className="text-[15px] text-neutral-600 leading-relaxed relative pl-5">
                          <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-natural-earth opacity-40" />
                          {sentence.trim()}{!sentence.endsWith('.') ? '.' : ''}
                        </p>
                      ))}
                    </div>
                 </motion.section>

                 {/* Pro Tip & Insights */}
                 <motion.section 
                   initial={{ opacity: 0, y: 20 }}
                   animate={{ opacity: 1, y: 0 }}
                   transition={{ delay: 0.3 }}
                   className="flex flex-col gap-6"
                 >
                    <div className="bg-white p-10 rounded-[32px] border border-natural-sage/10 shadow-lg shadow-natural-sage/5 flex-grow">
                      <div className="text-2xl font-serif italic text-natural-ink mb-6">Travel Insights</div>
                      <p className="text-[15px] text-neutral-600 leading-relaxed mb-10">
                        Based on the current atmospheric conditions in {weather.name}, we've analyzed the optimal outdoor window for your exploration.
                      </p>
                      
                      <div className="pro-tip-box bg-natural-sand p-6 rounded-[20px] border-l-4 border-natural-earth">
                        <h3 className="text-[11px] uppercase tracking-[1.5px] font-bold text-natural-earth mb-2">Pro-Tip</h3>
                        <p className="text-sm font-serif italic leading-relaxed text-[#5a5a54]">
                          "{advice?.proTip}"
                        </p>
                      </div>
                    </div>
                 </motion.section>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <footer className="pt-12 flex flex-col md:flex-row items-center justify-between gap-4 text-natural-muted opacity-70 border-t border-natural-sand/50">
            <div className="text-[11px] font-bold uppercase tracking-wider">
              Data powered by Gemini 2.0 Flash • Smart Travel Assistant
            </div>
            <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest">
              <span>Updated Live</span>
              <span className="px-3 py-1 bg-natural-sand rounded-full text-natural-ink">v1.2</span>
            </div>
        </footer>
      </div>
    </div>
  );
}
