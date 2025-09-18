import React, { useState } from 'react';
import type { Location } from '../../types';

export const LocationForm: React.FC<{
  item: Location | null;
  onSave: (data: Omit<Location, 'id'> | Location) => void;
  onCancel: () => void;
}> = ({ item, onSave, onCancel }) => {
  const [location, setLocation] = useState<Location | Omit<Location, 'id'>>(item || { name: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(location);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700">Mekan Adı (örn: Fizik Lab.)</label>
        <input
          type="text"
          name="name"
          value={location.name}
          onChange={(e) => setLocation({ name: e.target.value } as any)}
          className="mt-1 block w-full rounded-md border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500"
          required
        />
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700">
          İptal
        </button>
        <button type="submit" className="px-4 py-2 rounded-md bg-sky-500 hover:bg-sky-600 text-white">Kaydet</button>
      </div>
    </form>
  );
};

