import LinkExpired from '../common/LinkExpired';
import GuestChat from './GuestChat';

type VisitorInviteLandingProps = {
  token: string;
};

export default function VisitorInviteLanding({ token }: VisitorInviteLandingProps) {
  if (!token) return <LinkExpired />;
  return <GuestChat token={token} />;
}
