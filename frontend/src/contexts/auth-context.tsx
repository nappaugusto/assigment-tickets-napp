import React, { createContext, useContext } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authApi, type AuthUser } from '@/lib/api'

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.me,
    retry: false,
    staleTime: Infinity,
  })

  const loginMutation = useMutation({
    mutationFn: ({ username, password, rememberMe }: { username: string; password: string; rememberMe: boolean }) =>
      authApi.login(username, password, rememberMe),
    onSuccess: (res) => {
      if (res.user) {
        queryClient.setQueryData(['auth', 'me'], { authenticated: true, user: res.user })
      }
    },
  })

  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      queryClient.setQueryData(['auth', 'me'], { authenticated: false, user: null })
      queryClient.removeQueries({ queryKey: ['tickets'] })
    },
  })

  const user = data?.authenticated ? (data.user ?? null) : null

  const login = async (username: string, password: string, rememberMe = false) => {
    await loginMutation.mutateAsync({ username, password, rememberMe })
  }

  const logout = async () => {
    await logoutMutation.mutateAsync()
  }

  return (
    <AuthContext.Provider value={{ user, loading: isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
