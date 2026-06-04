"use client";

export function EnterVaultButton() {
  const handleScroll = () => {
    const element = document.getElementById("rag-section");
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <button 
      onClick={handleScroll}
      className="group flex items-center gap-2 px-8 py-4 bg-blue-600/90 backdrop-blur-md text-white rounded-full font-bold shadow-lg shadow-blue-500/50 hover:bg-blue-500 hover:shadow-blue-400/80 hover:scale-[1.02] transition-all duration-300"
    >
      Enter the Vault
      <svg className="w-4 h-4 transition-transform group-hover:translate-y-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </button>
  );
}
