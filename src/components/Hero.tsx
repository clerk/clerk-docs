
import Image from "next/image";

export const Hero = () => {
  return (
    <div className="flex flex-col md:flex-row items-center md:items-start justify-center md:justify-between pt-8 px-4 md:px-12 rounded-lg shadow-lg border-b-2 mb-8">
      <div className="md:w-1/2">
        <h2 className="text-4xl font-bold mb-4">Welcome to Clerk Docs</h2>
        <p className="text-gray-400 text-lg mb-8">Find all the guides and resources
          you need to develop with Clerk.</p>
      </div>
      <div className="md:pr-6">
        <img className="w-full h-auto md:max-w-lg" src="https://clerk.com/_next/image?url=%2Fimages%2Fdocs-hero-dark.svg&w=3840&q=75" alt="Hero Image" />
      </div>
    </div>
  )
}
