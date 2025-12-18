import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Trash2, Shield, User as UserIcon, AlertTriangle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

// API function to fetch all users
const fetchUsers = async () => {
  const { data } = await axios.get('/api/users');
  return data;
};

// API function to delete a user
const deleteUser = async (userId) => {
  await axios.delete(`/api/users/${userId}`);
};

const UserManagement = () => {
  const queryClient = useQueryClient();

  // Fetch users using React Query
  const { data: users, isLoading, isError, error } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  });

  // Mutation for deleting a user
  const deleteUserMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      toast.success('User deleted successfully!');
      // Invalidate the users query to refetch the latest data
      queryClient.invalidateQueries(['users']);
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Failed to delete user.');
    },
  });

  const handleDelete = (userId, userName) => {
    if (window.confirm(`Are you sure you want to delete the user "${userName}"? This action cannot be undone.`)) {
      deleteUserMutation.mutate(userId);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <span className="ml-4 text-lg text-gray-600">Loading Users...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex justify-center items-center h-full bg-red-50">
        <AlertTriangle className="h-8 w-8 text-red-500" />
        <span className="ml-4 text-lg text-red-700">Error: {error.message}</span>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white h-full overflow-y-auto">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">User Management</h1>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 bg-white">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users?.map((user) => (
              <tr key={user._id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{user.name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-500">{user.email}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    user.role === 'ADMIN' 
                      ? 'bg-blue-100 text-blue-800' 
                      : 'bg-green-100 text-green-800'
                  }`}>
                    {user.role === 'ADMIN' ? <Shield className="mr-1.5 h-4 w-4" /> : <UserIcon className="mr-1.5 h-4 w-4" />}
                    {user.role}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => handleDelete(user._id, user.name)}
                    disabled={deleteUserMutation.isPending}
                    className="text-red-600 hover:text-red-900 disabled:text-gray-400 transition-colors"
                    title="Delete User"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UserManagement;