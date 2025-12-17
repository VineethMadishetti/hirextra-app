import { useState, useEffect } from 'react';
import axios from 'axios';
import { Search } from 'lucide-react';

const UserDashboard = () => {
  const [candidates, setCandidates] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const api = axios.create({ 
    withCredentials: true, 
    baseURL: import.meta.env.VITE_API_URL || 'https://hirextra-app.onrender.com/api' 
  });

  const search = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/candidates/search?q=${query}`);
      setCandidates(data.candidates);
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  return (
    <div className="p-6">
      <div className="flex gap-4 mb-6">
        <div className="flex items-center border rounded px-3 bg-white w-full max-w-lg">
          <Search size={20} className="text-gray-500" />
          <input 
            className="w-full p-2 outline-none" 
            placeholder="Search name, job title, skills..." 
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <button onClick={search} className="bg-accent text-white px-6 py-2 rounded">Search</button>
      </div>

      {loading ? <p>Loading...</p> : (
        <div className="overflow-x-auto bg-white shadow rounded-lg">
          <table className="w-full text-left">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="p-4">Name</th>
                <th className="p-4">Job Title</th>
                <th className="p-4">Company</th>
                <th className="p-4">Country</th>
                <th className="p-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(c => (
                <tr key={c._id} className="border-b hover:bg-gray-50">
                  <td className="p-4">{c.firstName} {c.lastName}</td>
                  <td className="p-4">{c.jobTitle}</td>
                  <td className="p-4">{c.company || 'N/A'}</td>
                  <td className="p-4">{c.country}</td>
                  <td className="p-4">
                    <button className="text-accent hover:underline">Download Profile</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default UserDashboard;