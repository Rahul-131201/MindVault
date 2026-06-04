import Link from "next/link";

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-[#E2F0FE] text-slate-900 flex flex-col items-center justify-center px-6 py-16">
      <div className="max-w-3xl w-full bg-white/90 backdrop-blur-xl border border-slate-200 rounded-[2rem] shadow-xl p-10 text-center">
        <h1 className="text-5xl font-extrabold text-slate-900 mb-6">Contact</h1>
        <p className="text-lg text-slate-700 leading-relaxed mb-8">
          Thanks for checking out MindVault. For questions or support, please contact the owner of this deployment directly.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <Link
            href="/"
            className="px-6 py-3 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 transition"
          >
            Back to Home
          </Link>
          <Link
            href="/about"
            className="px-6 py-3 rounded-full bg-slate-100 text-slate-800 font-semibold hover:bg-slate-200 transition"
          >
            Learn About MindVault
          </Link>
        </div>
      </div>
    </div>
  );
}
