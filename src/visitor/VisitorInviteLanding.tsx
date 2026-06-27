import GuestChat from './GuestChat';

type VisitorInviteLandingProps = {
  token: string;
};

export default function VisitorInviteLanding({ token }: VisitorInviteLandingProps) {
  // Token is validated by Worker before SPA loads; if we reach here it's valid.
  // Return null initially — GuestChat handles its own loading/protected states.
  if (!token) return null;
  return <GuestChat token={token} />;
}
