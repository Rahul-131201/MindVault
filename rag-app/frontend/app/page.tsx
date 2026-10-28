import Spline from '@splinetool/react-spline/next';
import Link from 'next/link';
import ChatPage from './chat/page';
import { ScrollToTop } from '@/components/ScrollToTop';
import { AnimatedTitle } from '@/components/AnimatedTitle';
import { EnterVaultButton } from '@/components/EnterVaultButton';

export default function Home() {
  return (
    <div className="w-full bg-[#E2F0FE] flex flex-col" style={{ scrollBehavior: 'smooth' }}>
      <ScrollToTop />
      {/* 1. Landing Page Section */}
      <main className="relative w-full h-screen overflow-hidden">
        {/* 3D Spline Background */}
        <div 
          className="absolute inset-0 z-0 pointer-events-none"
          style={{ clipPath: 'inset(0 0 0 50%)' }}
        >
          <Spline
            scene="https://prod.spline.design/yju81WUGUIehB4EJ/scene.splinecode?v=2" 
          />
        </div>

        {/* UI Overlay */}
        <div className="absolute inset-0 z-10 flex flex-col pointer-events-none p-6">
          
          {/* Top Navigation - Glass/Water Effect */}
          <header className="w-full flex justify-center items-center py-5 pointer-events-auto bg-white/20 backdrop-blur-2xl shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] border-b border-white/40 absolute top-0 left-0 z-50">
            <nav className="flex justify-center gap-10 text-[15px] font-semibold text-slate-800">
              <Link href="/dashboard" className="hover:text-blue-600 transition-colors">Dashboard</Link>
              <Link href="/about" className="hover:text-blue-600 transition-colors">About</Link>
              <Link href="/contact" className="hover:text-blue-600 transition-colors">Contact</Link>
            </nav>
          </header>

          {/* Spacer */}
          <div className="h-24 w-full"></div>

          {/* Hero Content - Deep Glass/Water Effect */}
          <div className="flex-1 max-w-7xl w-full mx-auto px-4 flex items-center">
            <div className="max-w-2xl text-left pointer-events-auto mt-[-5%] bg-white/30 backdrop-blur-[40px] p-12 rounded-[3rem] shadow-[0_8px_32px_0_rgba(31,38,135,0.15)] border border-white/60">
              <AnimatedTitle />
              <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight leading-[1.15] mb-6">
                Unlock the Hidden Knowledge in Your Documents
              </h1>
              <p className="text-lg md:text-xl text-slate-700 mb-10 leading-relaxed max-w-xl font-medium">
                Securely upload PDFs and instantly retrieve accurate answers, insights, and exact citations powered by advanced RAG technology.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <EnterVaultButton />
                <Link 
                  href="/about"
                  className="group flex items-center gap-2 px-8 py-4 bg-white/30 backdrop-blur-md text-blue-700 border-2 border-white/50 rounded-full font-bold hover:bg-white/50 transition-all duration-300 shadow-[0_4px_16px_0_rgba(31,38,135,0.05)]"
                >
                  How RAG Works
                  <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 2. RAG UI Section (Scroll Target) */}
      <section id="rag-section" className="w-full h-screen relative z-20 overflow-hidden bg-[#E2F0FE]">
        <style>{`
          @keyframes blob {
            0% { transform: translate(0px, 0px) scale(1); }
            33% { transform: translate(30px, -50px) scale(1.1); }
            66% { transform: translate(-20px, 20px) scale(0.9); }
            100% { transform: translate(0px, 0px) scale(1); }
          }
          .animate-blob { animation: blob 7s infinite alternate ease-in-out; }
          .animation-delay-2000 { animation-delay: 2s; }
          .animation-delay-4000 { animation-delay: 4s; }
        `}</style>

        {/* Animated Background Orbs */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-400/40 rounded-full mix-blend-multiply blur-[100px] animate-blob z-0"></div>
        <div className="absolute top-[10%] right-[-10%] w-[30rem] h-[30rem] bg-cyan-300/40 rounded-full mix-blend-multiply blur-[120px] animate-blob animation-delay-2000 z-0"></div>
        <div className="absolute bottom-[-20%] left-[20%] w-[40rem] h-[40rem] bg-indigo-300/30 rounded-full mix-blend-multiply blur-[120px] animate-blob animation-delay-4000 z-0"></div>
        
        <div className="relative z-10 w-full h-full">
          <ChatPage />
        </div>
      </section>
    </div>
  );
}
