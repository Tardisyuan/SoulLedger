/**
 * Basic test to verify Jest + React Testing Library setup works.
 */
describe('Jest Setup', () => {
  it('should run basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should have testing-library/jest-dom matchers', () => {
    const div = document.createElement('div');
    div.textContent = 'Hello';
    document.body.appendChild(div);
    expect(div).toBeInTheDocument();
    document.body.removeChild(div);
  });
});
