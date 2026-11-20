import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from '@/lib/app.tsx';
import { JarvisProvider } from '@/lib/jarvis.tsx';
import { AppShell } from '@/components/layout/AppShell.tsx';
import { Spinner } from '@/components/ui/index.tsx';
import Dashboard from '@/pages/Dashboard.tsx';

const Chat = lazy(() => import('@/pages/Chat.tsx'));
const Agenda = lazy(() => import('@/pages/Agenda.tsx'));
const Tasks = lazy(() => import('@/pages/Tasks.tsx'));
const Notes = lazy(() => import('@/pages/Notes.tsx'));
const Projects = lazy(() => import('@/pages/Projects.tsx'));
const Routines = lazy(() => import('@/pages/Routines.tsx'));
const Focus = lazy(() => import('@/pages/Focus.tsx'));
const Knowledge = lazy(() => import('@/pages/Knowledge.tsx'));
const Reports = lazy(() => import('@/pages/Reports.tsx'));
const Settings = lazy(() => import('@/pages/Settings.tsx'));
const Login = lazy(() => import('@/pages/Login.tsx'));
const Executive = lazy(() => import('@/pages/Executive.tsx'));
const AutomationStudio = lazy(() => import('@/pages/AutomationStudio.tsx'));
const AiEngine = lazy(() => import('@/pages/AiEngine.tsx'));

function Loading() {
  return <div className="grid h-full place-items-center"><Spinner className="h-7 w-7" /></div>;
}

function Gate() {
  const { status } = useApp();
  if (status === 'loading') return <Loading />;
  if (status === 'signed_out') return <Suspense fallback={<Loading />}><Login /></Suspense>;
  return (
    <JarvisProvider>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="conversar" element={<Chat />} />
            <Route path="agenda" element={<Agenda />} />
            <Route path="tarefas" element={<Tasks />} />
            <Route path="notas" element={<Notes />} />
            <Route path="projetos" element={<Projects />} />
            <Route path="rotinas" element={<Routines />} />
            <Route path="foco" element={<Focus />} />
            <Route path="conhecimento" element={<Knowledge />} />
            <Route path="relatorios" element={<Reports />} />
            <Route path="configuracoes" element={<Settings />} />
            <Route path="executivo" element={<Executive />} />
            <Route path="automacoes" element={<AutomationStudio />} />
            <Route path="ai-engine" element={<AiEngine />} />
            <Route path="*" element={<Dashboard />} />
          </Route>
        </Routes>
      </Suspense>
    </JarvisProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Gate />
      </AppProvider>
    </BrowserRouter>
  );
}
