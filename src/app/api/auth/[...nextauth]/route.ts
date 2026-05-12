import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import AzureADProvider from 'next-auth/providers/azure-ad';
import { getUser, createUser, updateLastLogin, verifyUserPassword, verifyOTP } from '@/lib/firestore';

// Email/OTP/password provider is admin-only after Azure SSO rollout.
// Everyone else (gstar-raw.com, g-star.com) MUST sign in via Microsoft.
const ALLOWED_DOMAINS = ['fiberandface.com'];
const WHITELISTED_EMAILS = ['brunodheedene@gmail.com', 'bruno@fiberandface.com'];

const handler = NextAuth({
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID,
      authorization: { params: { scope: 'openid profile email' } },
    }),
    CredentialsProvider({
      id: 'credentials',
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        otp: { label: 'OTP', type: 'text' },
        mode: { label: 'Mode', type: 'text' }, // 'password' or 'otp'
      },
      async authorize(credentials) {
        if (!credentials?.email) return null;
        const email = (credentials.email as string).toLowerCase().trim();
        const mode = credentials.mode as string;

        // Check if user exists and is active
        const user = await getUser(email);
        if (!user) {
          // Auto-create for allowed domains
          const domain = email.split('@')[1];
          if (ALLOWED_DOMAINS.includes(domain) || WHITELISTED_EMAILS.includes(email)) {
            await createUser(email, {
              displayName: email.split('@')[0],
              role: WHITELISTED_EMAILS.includes(email) ? 'admin' : 'creator',
            });
          } else {
            return null; // Not authorized
          }
        } else {
          const userData = user as Record<string, unknown>;
          if (userData.active === false) return null;
        }

        if (mode === 'otp') {
          // Verify OTP
          const otp = credentials.otp as string;
          if (!otp) return null;
          const valid = await verifyOTP(email, otp);
          if (!valid) return null;
        } else if (mode === 'password') {
          // Verify password
          const password = credentials.password as string;
          if (!password) return null;
          const valid = await verifyUserPassword(email, password);
          if (!valid) return null;
        } else {
          return null;
        }

        await updateLastLogin(email);

        // Return user object for session
        const dbUser = await getUser(email);
        return {
          id: email,
          email,
          name: (dbUser as Record<string, unknown>)?.displayName as string || email,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user.email) return false;
      const email = user.email.toLowerCase();

      // Credentials provider: authorize() already validated everything.
      if (account?.provider === 'credentials') return true;

      // Azure AD: Phase 3 — temp allow any successful Entra login.
      // Phase 4 will gate on group claim 749c0cf5-...
      if (account?.provider === 'azure-ad') {
        const existing = await getUser(email);
        if (existing && (existing as Record<string, unknown>).active === false) {
          console.log(`[auth] reject azure-ad: user ${email} is inactive`);
          return false;
        }
        if (!existing) {
          const displayName = (profile as { name?: string } | undefined)?.name || email.split('@')[0];
          await createUser(email, { displayName, role: 'creator' });
        }
        await updateLastLogin(email);
        return true;
      }

      return false;
    },
    async jwt({ token, user }) {
      if (user) {
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.email && session.user) {
        session.user.email = token.email as string;
        const dbUser = await getUser(token.email as string);
        if (dbUser) {
          const data = dbUser as Record<string, unknown>;
          session.user.name = data.displayName as string || session.user.email;
          Object.assign(session, { role: data.role });
        }
      }
      return session;
    },
  },
  pages: {
    signIn: '/',
    error: '/',
  },
});

export { handler as GET, handler as POST };
