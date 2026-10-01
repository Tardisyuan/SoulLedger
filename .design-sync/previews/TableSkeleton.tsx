import { TableSkeleton } from "soulledger";

export const Default = () => (
  <table style={{ width: 480 }}>
    <tbody>
      <TableSkeleton rows={4} cols={4} />
    </tbody>
  </table>
);
