import { createRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Board from '../components/Board';
import { socket } from '../socket';

// Konva needs a real canvas, so react-konva is replaced with plain elements.
// Stage turns DOM mouse events into the shape Board expects from Konva.
jest.mock('react-konva', () => require('../test-utils/konvaMock').createKonvaMock());

// A fake socket that lets tests push server events into the component.
jest.mock('../socket', () => {
  const mockHandlers = {};
  return {
    socket: {
      id: 'me',
      connect: jest.fn(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      on: jest.fn((event, handler) => {
        mockHandlers[event] = handler;
      }),
      off: jest.fn(),
      receive: (event, ...args) => mockHandlers[event](...args),
    },
  };
});

const emitted = (event) => socket.emit.mock.calls.filter(([name]) => name === event).map(([, payload]) => payload);
const receive = (event, payload) => act(() => socket.receive(event, payload));

beforeEach(() => {
  jest.clearAllMocks();
  document.body.style.cursor = '';
});

describe('your own pointer', () => {
  test('is a ring in the color the server gave you', () => {
    render(<Board boardId="room" tool="pen" color="#111111" />);
    expect(document.body.style.cursor).toBe('');
    receive('board:you', { id: 'me', color: '#e11d48' });
    expect(document.body.style.cursor).toContain('data:image/svg+xml');
    expect(decodeURIComponent(document.body.style.cursor)).toContain('#e11d48');
  });

  test('follows a different color if the server gives you one', () => {
    render(<Board boardId="room" tool="pen" color="#111111" />);
    receive('board:you', { id: 'me', color: '#e11d48' });
    receive('board:you', { id: 'me', color: '#16a34a' });
    expect(decodeURIComponent(document.body.style.cursor)).toContain('#16a34a');
    expect(decodeURIComponent(document.body.style.cursor)).not.toContain('#e11d48');
  });

  test('is a hand while panning, and the ring comes back with the pen', () => {
    const { rerender } = render(<Board boardId="room" tool="pen" color="#111111" />);
    receive('board:you', { id: 'me', color: '#e11d48' });
    rerender(<Board boardId="room" tool="hand" color="#111111" />);
    expect(document.body.style.cursor).toBe('grab');
    rerender(<Board boardId="room" tool="pen" color="#111111" />);
    expect(document.body.style.cursor).toContain('data:image/svg+xml');
  });

  test('is put back to normal when you leave the board', () => {
    const { unmount } = render(<Board boardId="room" tool="pen" color="#111111" />);
    receive('board:you', { id: 'me', color: '#e11d48' });
    unmount();
    expect(document.body.style.cursor).toBe('');
  });

  test('stops listening for the assigned color when you leave', () => {
    const { unmount } = render(<Board boardId="room" tool="pen" color="#111111" />);
    unmount();
    expect(socket.off).toHaveBeenCalledWith('board:you');
  });
});

describe('what you send about yourself', () => {
  test('your cursor carries your name but not a color, since the server decides that', () => {
    render(<Board boardId="room" tool="pen" color="#111111" />);
    fireEvent.mouseMove(screen.getByTestId('stage'), { clientX: 5, clientY: 6 });
    const [message] = emitted('cursor:move');
    expect(message).toMatchObject({ x: 5, y: 6, name: expect.stringMatching(/^Guest \d+$/) });
    expect(message).not.toHaveProperty('color');
  });
});

describe("other people's cursors", () => {
  test('appear in their own color, with their name', () => {
    render(<Board boardId="room" tool="pen" color="#111111" />);
    receive('cursor:move', { id: 'other', x: 5, y: 6, name: 'Guest 7', color: '#2563eb' });
    expect(screen.getAllByTestId('text').some((t) => t.dataset.text === 'Guest 7')).toBe(true);
    expect(screen.getAllByTestId('tag')).toHaveLength(1);
  });

  test('disappear when the person leaves', () => {
    render(<Board boardId="room" tool="pen" color="#111111" />);
    receive('cursor:move', { id: 'other', x: 5, y: 6, name: 'Guest 7', color: '#2563eb' });
    receive('cursor:leave', 'other');
    expect(screen.queryAllByTestId('tag')).toHaveLength(0);
  });
});
