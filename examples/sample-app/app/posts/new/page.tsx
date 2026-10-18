import { createPost } from '../../actions';

export default function NewPostPage() {
  return (
    <form action={createPost}>
      <input name="title" />
      <button type="submit">Publish</button>
    </form>
  );
}
