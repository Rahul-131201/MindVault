"use client";

import Link from "next/link";
import { Database, FileText, Search, BrainCircuit, ArrowRight } from "lucide-react";
import { useEffect } from "react";

export default function AboutPage() {
  
  // Optional: subtle scroll-based parallax on blobs
  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY;
      document.documentElement.style.setProperty('--scroll-y', `${scrolled}px`);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const steps = [
    {
      id: "01",
      title: "Document Ingestion",
      desc: "When you upload a PDF, MindVault seamlessly parses the raw text and intelligently chunks it into optimal, overlapping semantic segments, preserving the deep meaning of long documents.",
      icon: <FileText className="w-12 h-12 text-blue-600" />,
      color: "from-blue-400/30 to-blue-600/10"
    },
    {
      id: "02",
      title: "Neural Embedding",
      desc: "Each text chunk is passed through an advanced transformer model, converting human language into high-dimensional mathematical vectors. This allows the AI to understand concepts, not just keywords.",
      icon: <Database className="w-12 h-12 text-cyan-600" />,
      color: "from-cyan-400/30 to-cyan-600/10"
    },
    {
      id: "03",
      title: "Semantic Retrieval",
      desc: "When you ask a question, your query is also vectorized. MindVault searches its vector database at lightning speed to retrieve the exact paragraphs that match the true intent of your query.",
      icon: <Search className="w-12 h-12 text-indigo-600" />,
      color: "from-indigo-400/30 to-indigo-600/10"
    },
    {
      id: "04",
      title: "Grounded Synthesis",
      desc: "The retrieved context is fed into the Large Language Model alongside your question. The AI synthesizes a brilliant answer, perfectly grounded in your data, complete with exact source citations.",
      icon: <BrainCircuit className="w-12 h-12 text-purple-600" />,
      color: "from-purple-400/30 to-purple-600/10"
    }
  ];

  return (
    <div className="min-h-screen bg-[#E2F0FE] text-slate-900 selection:bg-blue-300 selection:text-blue-900">
      <style>{`
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob { animation: blob 12s infinite alternate ease-in-out; }
        .animation-delay-2000 { animation-delay: 2s; }
        .animation-delay-4000 { animation-delay: 4s; }
        
        .fade-in-up {
          animation: fadeInUp 1s ease-out forwards;
          opacity: 0;
          transform: translateY(30px);
        }
        @keyframes fadeInUp {
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Floating Animated Background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40rem] h-[40rem] bg-blue-500/20 rounded-full mix-blend-multiply blur-[120px] animate-blob"></div>
        <div className="absolute top-[30%] right-[-10%] w-[35rem] h-[35rem] bg-cyan-400/20 rounded-full mix-blend-multiply blur-[120px] animate-blob animation-delay-2000"></div>
        <div className="absolute bottom-[-10%] left-[10%] w-[45rem] h-[45rem] bg-indigo-400/20 rounded-full mix-blend-multiply blur-[120px] animate-blob animation-delay-4000"></div>
      </div>

      {/* Glass Navigation */}
      <header className="fixed top-0 left-0 w-full z-50 py-5 px-8 bg-white/20 backdrop-blur-2xl shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] border-b border-white/40">
        <nav className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="font-extrabold text-xl tracking-tight text-slate-900 flex items-center gap-2">
            MindVault <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-widest bg-blue-600 text-white">Intelligence</span>
          </div>
          <Link href="/" className="px-6 py-2.5 rounded-full bg-white/50 hover:bg-white/80 transition-all font-bold text-sm text-slate-800 shadow-sm border border-white/60 hover:scale-105">
            &larr; Return to Vault
          </Link>
        </nav>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-5xl mx-auto px-6 pt-40 pb-32">
        
        {/* Hero Section */}
        <div className="text-center mb-32 fade-in-up">
          <div className="inline-block mb-6 px-5 py-2 rounded-full bg-white/40 backdrop-blur-md border border-white/60 text-blue-700 font-bold text-sm tracking-widest uppercase shadow-sm">
            Behind the Magic
          </div>
          <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-8 leading-tight">
            The Architecture of <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-500">
              Intelligence
            </span>
          </h1>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed font-medium">
            MindVault doesn't just read your documents. It understands them mathematically. Explore the 4-step Neural Pipeline that powers our Retrieval-Augmented Generation.
          </p>
        </div>

        {/* Sticky Stacking Cards (Storytelling Timeline with Parallax/3D feels) */}
        <div className="space-y-32 pb-32">
          {steps.map((step, index) => (
            <div 
              key={step.id}
              className="sticky transition-all duration-700 hover:scale-[1.02] group"
              style={{ 
                top: `${120 + (index * 40)}px`, 
                zIndex: index * 10 
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-blue-50/20 opacity-0 group-hover:opacity-100 transition-opacity duration-700 rounded-[3rem] blur-2xl -z-10" />
              <div className="bg-white/50 backdrop-blur-[40px] shadow-[0_16px_64px_0_rgba(31,38,135,0.1)] border border-white/70 rounded-[3rem] p-12 md:p-16 relative overflow-hidden flex flex-col md:flex-row items-center gap-12 transform-gpu transition-transform duration-500 group-hover:-translate-y-2 group-hover:rotate-1 hover:shadow-[0_32px_128px_0_rgba(31,38,135,0.2)]">
                
                {/* Huge Background Number */}
                <div className="absolute -right-12 -bottom-20 text-[300px] font-black text-slate-900/[0.03] select-none pointer-events-none transition-transform duration-1000 group-hover:scale-110 group-hover:-translate-x-10 group-hover:-translate-y-10">
                  {step.id}
                </div>

                {/* Left: Icon */}
                <div className="flex flex-col items-center shrink-0 relative z-10">
                  <div className={`w-32 h-32 rounded-[2rem] bg-gradient-to-br ${step.color} border border-white/60 shadow-xl flex items-center justify-center transform group-hover:rotate-12 group-hover:scale-110 transition-transform duration-700 ease-out`}>
                    {step.icon}
                  </div>
                </div>

                {/* Right: Content */}
                <div className="relative z-10 flex-1 text-center md:text-left">
                  <h2 className="text-3xl md:text-4xl font-extrabold mb-5 text-slate-900 tracking-tight flex items-center justify-center md:justify-start gap-4">
                    <span className="text-blue-500/40 text-5xl">{step.id}</span> 
                    {step.title}
                  </h2>
                  <p className="text-lg md:text-xl text-slate-700 leading-relaxed font-medium">
                    {step.desc}
                  </p>
                </div>

              </div>
            </div>
          ))}
        </div>

        {/* CTA Footer */}
        <div className="text-center mt-40 relative z-10 fade-in-up" style={{ animationDelay: '0.5s' }}>
          <h2 className="text-5xl font-black mb-10 text-slate-900">Ready to query your data?</h2>
          <Link href="/#rag-ui" className="inline-flex items-center gap-4 px-12 py-6 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-bold text-xl shadow-[0_8px_32px_0_rgba(37,99,235,0.4)] hover:shadow-[0_16px_64px_0_rgba(37,99,235,0.6)] hover:scale-105 transition-all duration-300">
            Start the Vault
            <ArrowRight className="w-6 h-6" />
          </Link>
        </div>

      </main>
    </div>
  );
}
