import React, { useState } from 'react';

interface AuthScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (schoolName: string, adminEmail: string, adminPassword: string) => Promise<void>;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLogin, onRegister }) => {
  const [isLoginView, setIsLoginView] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      if (isLoginView) {
        await onLogin(email, password);
      } else {
        await onRegister(schoolName, email, password);
      }
    } catch (err: any) {      
      setError(err.message || 'Bir hata oluştu.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-xl shadow-lg">
        <h1 className="text-3xl font-bold text-slate-900 text-center mb-2">
          {isLoginView ? 'Giriş Yap' : 'Okul Kaydı'}
        </h1>
        <p className="text-slate-500 text-center mb-8">
          {isLoginView ? 'Hesabınıza erişmek için giriş yapın.' : 'Yeni bir okul ve yönetici hesabı oluşturun.'}
        </p>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {!isLoginView && (
            <div>
              <label htmlFor="schoolName" className="block text-sm font-medium text-slate-700">
                Okul Adı
              </label>
              <div className="mt-1">
                <input
                  id="schoolName"
                  name="schoolName"
                  type="text"
                  required
                  value={schoolName}
                  onChange={e => setSchoolName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-sky-500 focus:border-sky-500"
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              {isLoginView ? 'E-posta Adresi' : 'Yönetici E-posta Adresi'}
            </label>
            <div className="mt-1">
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-sky-500 focus:border-sky-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Parola
            </label>
            <div className="mt-1">
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isLoginView ? "current-password" : "new-password"}
                required
                minLength={6}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-sky-500 focus:border-sky-500"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm">
                {error}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 disabled:bg-slate-400"
            >
              {isLoading ? 'İşleniyor...' : (isLoginView ? 'Giriş Yap' : 'Kaydol ve Okul Oluştur')}
            </button>
          </div>
        </form>

        <div className="mt-6 text-center">
          <button 
            onClick={() => setIsLoginView(!isLoginView)}
            className="text-sm text-sky-600 hover:text-sky-500"
          >
            {isLoginView ? 'Hesabınız yok mu? Okul kaydı yapın.' : 'Zaten bir hesabınız var mı? Giriş yapın.'}
          </button>
        </div>
      </div>
    </div>
  );
};
