export const dynamic = "force-dynamic";

async function posts() {
  const response = await fetch(`${process.env.API_URL}/posts`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GET /posts answered ${response.status}`);
  }
  return response.json();
}

export default async function Home() {
  const list = await posts();
  return (
    <main>
      <h1>Blog</h1>
      <p>
        Environment <strong>{process.env.ENV_NAME}</strong>. The posts come from MySQL, through the Laravel API at{" "}
        <a href={process.env.PUBLIC_API_URL}>{process.env.PUBLIC_API_URL}</a>.
      </p>
      {list.map((post) => (
        <article key={post.id}>
          <h2>{post.title}</h2>
          <p>{post.body}</p>
        </article>
      ))}
    </main>
  );
}
