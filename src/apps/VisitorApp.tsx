import VisitorInviteLanding from '../visitor/VisitorInviteLanding';

type VisitorAppProps = {
  token: string;
};

export default function VisitorApp({ token }: VisitorAppProps) {
  return <VisitorInviteLanding token={token} />;
}
